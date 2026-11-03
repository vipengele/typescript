import { type Scheduler, systemScheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { DEFAULT_DELIVERY_LIMITS, type DeliveryLimits } from "../delivery/delivery";
import type { LifecycleTargets } from "../delivery/unload";
import { LoggingConfigError } from "./config-error";
import type { LogRecord, Sink } from "./record";

/** One record and the Resource it was written under; the Resource can differ from entry to entry. */
export interface BatchEntry {
  readonly record: LogRecord;
  readonly resource: Resource;
}

/**
 * A destination that takes many records at once. A returned Promise is awaited before the next batch
 * is handed over; a throw or a rejection drops the batch as `"failed"`.
 */
export interface BatchSink {
  writeBatch(entries: readonly BatchEntry[]): void | Promise<void>;
}

/** Why records left the batching sink without reaching the inner sink. */
export type BatchDropReason = "queue-full" | "failed" | "closed";

/** The limits a batching sink takes from the delivery core, under the same names. */
export type BatchingSinkLimits = Pick<DeliveryLimits, "maxQueueSize" | "maxBatchSize" | "scheduleDelayMs">;

/** How a batching sink buffers, when it hands records on, and how it reports drops. */
export interface BatchingSinkOptions {
  /**
   * Buffer and timing limits over the delivery core's defaults. The sizes are integers of at least
   * 1; the delay is positive and finite.
   */
  readonly limits?: Partial<BatchingSinkLimits>;
  /**
   * Told why records were dropped, how many, and for `"failed"` the error the inner threw or
   * rejected with; a throw is swallowed.
   */
  readonly onDrop?: (reason: BatchDropReason, count: number, error?: unknown) => void;
  /** Supplies the interval timer and the flush deadline; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** Where `pagehide` and `visibilitychange` arrive; detected on `globalThis` when omitted, none watched for `{}`. */
  readonly lifecycle?: LifecycleTargets;
  /**
   * Hands the buffer to the inner on process exit, where the runtime has exit hooks. Defaults to
   * `false`. The exit listener cannot await, so only a synchronous `writeBatch` completes.
   */
  readonly flushOnExit?: boolean;
}

/** A {@link Sink} that hands records on in batches, and can be flushed and closed. */
export type BatchingSink = Sink & {
  /** Hands on everything buffered; resolves `true` once it all settled, `false` on timeout. Never rejects. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, drops what is left on timeout as `"closed"`, and turns every later `write` into a drop. Never rejects. */
  close(timeoutMs?: number): Promise<boolean>;
};

const INTEGER_LIMITS = ["maxQueueSize", "maxBatchSize"] as const;

/**
 * Why `options` cannot configure a batching sink, naming the first invalid limit or option, or
 * `undefined` when every one given is valid. The text completes a message that begins
 * "createBatchingSink expects ".
 */
export function batchingSinkOptionsProblem(options: BatchingSinkOptions): string | undefined {
  const { limits = {} } = options;
  const integer = INTEGER_LIMITS.find((name) => !isValidInteger(limits[name]));
  if (integer !== undefined) {
    return `${integer} to be an integer of at least 1, got ${limits[integer]}`;
  }
  if (!isValidDuration(limits.scheduleDelayMs)) {
    return `scheduleDelayMs to be positive and finite, got ${limits.scheduleDelayMs}`;
  }
  return undefined;
}

/** Throws a `LoggingConfigError` when {@link batchingSinkOptionsProblem} finds `options` invalid. */
export function assertBatchingSinkOptions(options: BatchingSinkOptions): void {
  const problem = batchingSinkOptionsProblem(options);
  if (problem !== undefined) {
    throw new LoggingConfigError(`createBatchingSink expects ${problem}`);
  }
}

function hasWriteBatch(inner: BatchSink | Sink): inner is BatchSink {
  return typeof (inner as Partial<BatchSink>).writeBatch === "function";
}

/**
 * The {@link BatchSink} for `inner`: `inner` itself when it has `writeBatch`, even if it also has
 * `write`; otherwise a sink that replays the entries to `inner.write` in order. A throw from
 * `write` drops only that record, reported to `onFailed` with a count of 1 and the error, and the
 * replay continues with the next record.
 */
export function toBatchSink(inner: BatchSink | Sink, onFailed: (count: number, error: unknown) => void): BatchSink {
  if (hasWriteBatch(inner)) {
    return inner;
  }
  return {
    writeBatch(entries) {
      for (const { record, resource } of entries) {
        try {
          inner.write(record, resource);
        } catch (error) {
          onFailed(1, error);
        }
      }
    },
  };
}

function isValidInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1);
}

function isValidDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0);
}

function noop(): void {}

/** Fills every limit `given` leaves out from {@link DEFAULT_DELIVERY_LIMITS}. */
function resolveLimits(given: Partial<BatchingSinkLimits> = {}): BatchingSinkLimits {
  return {
    maxQueueSize: given.maxQueueSize ?? DEFAULT_DELIVERY_LIMITS.maxQueueSize,
    maxBatchSize: given.maxBatchSize ?? DEFAULT_DELIVERY_LIMITS.maxBatchSize,
    scheduleDelayMs: given.scheduleDelayMs ?? DEFAULT_DELIVERY_LIMITS.scheduleDelayMs,
  };
}

/**
 * The state machine behind {@link createBatchingSink}: the buffer, the one batch in flight, the
 * interval timer and the drains. Every hand-off to the inner goes through `#handOff`, which tracks
 * it in `#outstanding` until it settles, so `flush` and `close` wait on any batch, whichever path
 * started it.
 */
class BatchingQueue {
  readonly #inner: BatchSink;
  readonly #limits: BatchingSinkLimits;
  readonly #scheduler: Scheduler;
  readonly #onDrop: NonNullable<BatchingSinkOptions["onDrop"]>;

  readonly #buffer: BatchEntry[] = [];
  /** Set from just before `writeBatch` is called until the batch settles, so a `write` from inside `writeBatch` never starts a second batch. */
  #inFlight = false;
  /** Every hand-off not yet settled. */
  readonly #outstanding = new Set<Promise<void>>();
  /** Aborts the pending interval sleep; set while one is pending. */
  #timer: AbortController | undefined;
  /** How many `flush`/`close` calls are waiting; while above 0, anything buffered is handed on without waiting for the timer. */
  #draining = 0;
  #closed = false;
  #closing: Promise<boolean> | undefined;
  readonly #idleWaiters = new Set<() => void>();

  constructor(inner: BatchSink | Sink, options: BatchingSinkOptions) {
    this.#limits = resolveLimits(options.limits);
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#onDrop = options.onDrop ?? noop;
    this.#inner = toBatchSink(inner, (count, error) => this.#drop("failed", count, error));
  }

  write(record: LogRecord, resource: Resource): void {
    if (this.#closed) {
      this.#drop("closed", 1);
      return;
    }
    if (this.#buffer.length >= this.#limits.maxQueueSize) {
      this.#drop("queue-full", 1);
      return;
    }
    this.#buffer.push({ record, resource });
    this.#pump();
  }

  flush(timeoutMs = DEFAULT_DELIVERY_LIMITS.flushTimeoutMs): Promise<boolean> {
    return this.#closing ?? this.#drain(timeoutMs);
  }

  close(timeoutMs = DEFAULT_DELIVERY_LIMITS.flushTimeoutMs): Promise<boolean> {
    if (this.#closing === undefined) {
      this.#closed = true;
      this.#closing = this.#drain(timeoutMs).then((drained) => {
        if (!drained) {
          this.#abandon();
        }
        return drained;
      });
    }
    return this.#closing;
  }

  #drop(reason: BatchDropReason, count: number, ...error: [] | [unknown]): void {
    const onDrop = this.#onDrop;
    try {
      onDrop(reason, count, ...error);
    } catch {
      // onDrop is the host's observer; its failure is not the sink's to report.
    }
  }

  /**
   * Hands `entries` to the inner and returns a promise that resolves once the batch settled. A
   * synchronous throw or a rejection drops the batch as `"failed"`; the promise itself never rejects.
   */
  #handOff(entries: readonly BatchEntry[]): Promise<void> {
    let settled: Promise<void>;
    try {
      settled = Promise.resolve(this.#inner.writeBatch(entries)).then(noop, (error: unknown) => {
        this.#drop("failed", entries.length, error);
      });
    } catch (error) {
      this.#drop("failed", entries.length, error);
      settled = Promise.resolve();
    }
    const tracked = settled.then(() => {
      this.#outstanding.delete(tracked);
    });
    this.#outstanding.add(tracked);
    return tracked;
  }

  /** Takes the oldest batch from the buffer and hands it on, the one batch in flight; the next starts once it settles. */
  #startBatch(): void {
    this.#stopTimer();
    this.#inFlight = true;
    const entries = this.#buffer.splice(0, this.#limits.maxBatchSize);
    void this.#handOff(entries).then(() => {
      this.#inFlight = false;
      this.#pump();
      this.#notifyIdle();
    });
  }

  /**
   * Starts a batch when none is in flight and either a full batch is buffered or a drain is
   * waiting. Otherwise, with records buffered and no drain waiting, makes sure the interval timer
   * is armed.
   */
  #pump(): void {
    const buffered = this.#buffer.length;
    if (!this.#inFlight && (buffered >= this.#limits.maxBatchSize || (this.#draining > 0 && buffered > 0))) {
      this.#startBatch();
      return;
    }
    if (buffered > 0 && this.#draining === 0) {
      this.#startTimer();
    }
  }

  #stopTimer(): void {
    this.#timer?.abort();
    this.#timer = undefined;
  }

  /** Arms the interval timer; a no-op while one is pending. */
  #startTimer(): void {
    if (this.#timer !== undefined) {
      return;
    }
    const controller = new AbortController();
    this.#timer = controller;
    this.#scheduler.sleep(this.#limits.scheduleDelayMs, controller.signal).then(() => this.#timerElapsed(controller), noop);
  }

  /**
   * Starts a batch when the interval passes with none in flight. With one in flight, the batch's
   * settling re-arms the timer for whatever it leaves buffered.
   */
  #timerElapsed(controller: AbortController): void {
    // A sleep that resolved before stopTimer aborted it still runs this continuation; it must not
    // clear the handle of the timer that replaced it or start a batch on that timer's behalf.
    if (this.#timer !== controller) {
      return;
    }
    this.#timer = undefined;
    if (!this.#inFlight) {
      this.#startBatch();
    }
  }

  #notifyIdle(): void {
    if (this.#buffer.length > 0 || this.#outstanding.size > 0) {
      return;
    }
    for (const resolve of this.#idleWaiters) {
      resolve();
    }
    this.#idleWaiters.clear();
  }

  /** Drops every buffered record as `"closed"`; a batch already handed on is left to settle. */
  #abandon(): void {
    this.#stopTimer();
    const buffered = this.#buffer.splice(0).length;
    if (buffered > 0) {
      this.#drop("closed", buffered);
    }
  }

  /** Hands everything on, batch by batch, and resolves `true` once idle, `false` once `timeoutMs` elapses first. */
  async #drain(timeoutMs: number): Promise<boolean> {
    this.#draining += 1;
    this.#stopTimer();
    this.#pump();
    let onIdle = noop;
    const idle = new Promise<boolean>((resolve) => {
      onIdle = () => resolve(true);
      this.#idleWaiters.add(onIdle);
    });
    this.#notifyIdle();
    const deadline = new AbortController();
    const elapsed = this.#scheduler.sleep(timeoutMs, deadline.signal).then(
      () => false,
      () => false,
    );
    try {
      return await Promise.race([idle, elapsed]);
    } finally {
      deadline.abort();
      this.#idleWaiters.delete(onIdle);
      this.#draining -= 1;
      if (!this.#closed) {
        this.#pump();
      }
    }
  }
}

/**
 * Wraps `inner` in a {@link BatchingSink}: records are buffered and handed to `inner.writeBatch`, or
 * replayed to a plain Sink's `write`, once `maxBatchSize` are buffered, once `scheduleDelayMs` has
 * passed since the buffer stopped being empty, and on `flush` and `close`. One batch is in flight at
 * a time, and a returned Promise is awaited before the next starts. Nothing is retried, and the
 * inner's own `flush` and `close` are never called: its lifecycle belongs to the caller. `write`
 * returns at once and never throws. Throws a `LoggingConfigError` for an invalid option.
 */
export function createBatchingSink(inner: BatchSink | Sink, options: BatchingSinkOptions = {}): BatchingSink {
  assertBatchingSinkOptions(options);
  const queue = new BatchingQueue(inner, options);
  return {
    write: (record, resource) => queue.write(record, resource),
    flush: (timeoutMs) => queue.flush(timeoutMs),
    close: (timeoutMs) => queue.close(timeoutMs),
  };
}
