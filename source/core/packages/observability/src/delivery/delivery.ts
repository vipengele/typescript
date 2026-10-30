import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { type BackoffStrategy, createRetry, exponentialBackoff, type Outcome, withJitter } from "@vipengele/ts-core-resilience/retry";
import { createTimeout } from "@vipengele/ts-core-resilience/timeout";
import { classifyStatus, parseRetryAfter } from "./retry-policy";

/**
 * Why entries left the delivery without reaching the collector:
 *
 * - `"queue-full"` — the buffer held `maxQueueSize` entries; the newest one is dropped.
 * - `"rejected"` — the collector answered with a status that is not retried, or the batch could
 *   not be sent at all: `encode` threw, the `headers` thunk threw, or `fetch` threw synchronously.
 * - `"retries-exhausted"` — every attempt failed with a network error, a timeout or a retryable status.
 * - `"closed"` — still buffered or in flight when `close` ran out of time.
 * - `"unload-budget"` — left over when the page or process unloaded.
 */
export type DropReason = "queue-full" | "rejected" | "retries-exhausted" | "closed" | "unload-budget";

/** One item to export, the Resource it was enqueued with, and when the delivery received it. */
export interface DeliveryEntry<T> {
  readonly item: T;
  readonly resource: Resource;
  /** The clock's epoch milliseconds at `enqueue`. */
  readonly observedMs: number;
}

/** The part of a `fetch` response the delivery reads. */
export interface DeliveryResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** Cancelled unread, so the connection is released without buffering a body nobody reads. */
  readonly body?: { cancel(): Promise<unknown> } | null;
}

/** The request one export attempt makes. */
export interface DeliveryRequest {
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** A `fetch`-compatible function; `globalThis.fetch` is one. */
export type DeliveryFetch = (url: string, init: DeliveryRequest) => Promise<DeliveryResponse>;

export interface DeliveryLimits {
  /** How many entries wait in the buffer at most; the batch in flight does not count. */
  readonly maxQueueSize: number;
  /** How many entries one export carries at most, and the buffer size that triggers an export. */
  readonly maxBatchSize: number;
  /** How long after the first entry reaches an empty buffer it is exported, at the latest. */
  readonly scheduleDelayMs: number;
  /** How many attempts one batch gets, the first included. */
  readonly maxAttempts: number;
  /** How long one attempt may run before it is abandoned and counts as failed. */
  readonly attemptTimeoutMs: number;
  /** How long `flush` and `close` wait when called without a timeout. */
  readonly flushTimeoutMs: number;
}

export interface DeliveryOptions<T> {
  /** Where each batch is POSTed. */
  readonly url: string;
  /** Sent with every export, read once per batch when a thunk; `content-type` is always `application/json`. */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /** Defaults to `globalThis.fetch`, looked up at each attempt. */
  readonly fetch?: DeliveryFetch;
  /** Stamps `observedMs` and dates a `Retry-After`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the schedule delay, the backoff, the attempt timeout and the flush timeout; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** Turns one batch into the request body, at export time. */
  readonly encode: (entries: ReadonlyArray<DeliveryEntry<T>>) => string;
  readonly limits?: Partial<DeliveryLimits>;
  /** The delay before each retry a `Retry-After` does not name; defaults to full-jitter exponential backoff from 1 s to 30 s. */
  readonly backoff?: BackoffStrategy;
  /** Told how many entries were dropped and why; a throw is swallowed. */
  readonly onDrop?: (reason: DropReason, count: number) => void;
}

export interface Delivery<T> {
  /** Buffers `item` for export. Returns at once and never throws; a no-op once `close` was called. */
  enqueue(item: T, resource: Resource): void;
  /**
   * Exports everything buffered and cuts any backoff short, then resolves `true` once the buffer
   * and the batch in flight are delivered or dropped, `false` if `timeoutMs` elapses first. Never
   * rejects. After `close` it resolves as `close` does.
   */
  flush(timeoutMs?: number): Promise<boolean>;
  /**
   * Flushes, drops whatever is left on timeout as `"closed"`, and turns every later `enqueue` into
   * a no-op. Resolves as the flush did; a second call returns the first call's promise. Never rejects.
   */
  close(timeoutMs?: number): Promise<boolean>;
}

/** OpenTelemetry SDK batch processor and OTLP/HTTP exporter defaults. */
export const DEFAULT_DELIVERY_LIMITS: DeliveryLimits = Object.freeze({
  maxQueueSize: 2048,
  maxBatchSize: 512,
  scheduleDelayMs: 5000,
  maxAttempts: 5,
  attemptTimeoutMs: 10_000,
  flushTimeoutMs: 2000,
});

/** The result of one attempt that reached the collector, or a request that could not be made. */
type AttemptResult =
  | { readonly kind: "status"; readonly status: number; readonly retryAfterMs: number | undefined }
  | { readonly kind: "unsent" };

/** A batch taken from the buffer. `settled` turns true once its entries are delivered or dropped, exactly once. */
interface Batch<T> {
  readonly entries: ReadonlyArray<DeliveryEntry<T>>;
  /** Aborts the attempt in flight and the retry around it. */
  readonly abort: AbortController;
  settled: boolean;
}

const UNSENT: AttemptResult = Object.freeze({ kind: "unsent" });

function noop(): void {}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`createDelivery expects ${name} to be an integer of at least 1, got ${value}`);
  }
}

function retryable(outcome: Outcome<unknown>): boolean {
  if (!outcome.ok) {
    return true;
  }
  const result = outcome.value as AttemptResult;
  return result.kind === "status" && classifyStatus(result.status) === "retryable";
}

function retryAfterOf(outcome: Outcome<unknown>): number | undefined {
  return outcome.ok ? (outcome.value as { retryAfterMs?: number }).retryAfterMs : undefined;
}

function defaultFetch(url: string, init: DeliveryRequest): Promise<DeliveryResponse> {
  return globalThis.fetch(url, init);
}

/**
 * Creates a {@link Delivery}: a buffer of entries exported as OTLP/HTTP JSON batches, one batch in
 * flight at a time. An export starts when the buffer reaches `maxBatchSize`, or `scheduleDelayMs`
 * after the first entry reaches an empty buffer; once a batch settles, a buffer holding a full batch
 * is exported at once. A network error, a timeout, 429, 502, 503 and 504 are retried with
 * `backoff`, or after the delay a `Retry-After` names. Payload-generic: `encode` alone knows `T`.
 *
 * Throws a `RangeError` when `maxQueueSize` or `maxBatchSize` is not an integer of at least 1, and
 * a `ResilienceConfigError` for an invalid `maxAttempts` or `attemptTimeoutMs`.
 */
export function createDelivery<T>(options: DeliveryOptions<T>): Delivery<T> {
  const limits: DeliveryLimits = { ...DEFAULT_DELIVERY_LIMITS, ...options.limits };
  requirePositiveInteger("maxQueueSize", limits.maxQueueSize);
  requirePositiveInteger("maxBatchSize", limits.maxBatchSize);
  const { url, encode } = options;
  const doFetch = options.fetch ?? defaultFetch;
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? systemScheduler;
  const onDrop = options.onDrop ?? noop;

  const buffer: DeliveryEntry<T>[] = [];
  let inFlight: Batch<T> | undefined;
  /** Aborts the pending schedule-delay sleep; set while one is pending. */
  let timer: AbortController | undefined;
  /** The schedule delay elapsed while a batch was in flight; the next export is owed. */
  let timerDue = false;
  /** How many `flush`/`close` calls are waiting; while above 0, anything buffered is exported at once. */
  let draining = 0;
  /** Aborted while draining: a backoff sleep in progress ends, and one starting is skipped. */
  let hurry = new AbortController();
  let closing: Promise<boolean> | undefined;
  const idleWaiters = new Set<() => void>();

  const drop = (reason: DropReason, count: number): void => {
    try {
      onDrop(reason, count);
    } catch {
      // onDrop is the host's observer; its failure is not the delivery's to report.
    }
  };

  /** Records how `batch` ended; a batch that already settled, or none at all, ignores the report. */
  const settle = (batch: Batch<T> | undefined, reason: DropReason | undefined): void => {
    if (batch === undefined || batch.settled) {
      return;
    }
    batch.settled = true;
    if (reason !== undefined) {
      drop(reason, batch.entries.length);
    }
  };

  /**
   * The scheduler the retry waits on: a backoff ends early, resolving rather than rejecting, when
   * `hurry` or the retry's own signal aborts, and is skipped while `hurry` is already aborted. An
   * aborted batch still stops: its next attempt rejects before `fetch` is called, since the attempt
   * timeout checks the signal first, and the retry then rejects with the signal's reason.
   */
  const backoffScheduler: Scheduler = {
    async sleep(ms, signal = new AbortController().signal) {
      const hurried = hurry.signal;
      if (hurried.aborted) {
        return;
      }
      await scheduler.sleep(ms, AbortSignal.any([signal, hurried])).catch(noop);
    },
  };

  const retry = createRetry(
    "vipengele.delivery",
    {
      maxAttempts: limits.maxAttempts,
      backoff: options.backoff ?? withJitter(exponentialBackoff({ initialMs: 1000, maxMs: 30_000 }), "full"),
      shouldRetry: retryable,
      retryAfter: retryAfterOf,
    },
    { clock, scheduler: backoffScheduler },
  );
  const timeout = createTimeout("vipengele.delivery.attempt", { durationMs: limits.attemptTimeoutMs }, { clock, scheduler });

  /** One POST. A synchronous throw from `fetch` gives `unsent`; a rejection fails the attempt. */
  const attempt = async (request: Omit<DeliveryRequest, "signal">, signal: AbortSignal): Promise<AttemptResult> => {
    let pending: Promise<DeliveryResponse>;
    try {
      pending = doFetch(url, { ...request, signal });
    } catch {
      return UNSENT;
    }
    const response = await pending;
    response.body?.cancel().catch(noop);
    return { kind: "status", status: response.status, retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), clock()) };
  };

  const exportBatch = async (batch: Batch<T>): Promise<void> => {
    let request: Omit<DeliveryRequest, "signal">;
    try {
      const configured = typeof options.headers === "function" ? options.headers() : options.headers;
      request = { method: "POST", headers: { ...configured, "content-type": "application/json" }, body: encode(batch.entries) };
    } catch {
      settle(batch, "rejected");
      return;
    }
    try {
      const result = await retry.execute((ctx) => timeout.execute(({ signal }) => attempt(request, signal), { signal: ctx.signal }), {
        signal: batch.abort.signal,
      });
      if (result.kind === "unsent") {
        settle(batch, "rejected");
        return;
      }
      const verdict = classifyStatus(result.status);
      settle(batch, verdict === "delivered" ? undefined : verdict === "retryable" ? "retries-exhausted" : "rejected");
    } catch {
      settle(batch, "retries-exhausted");
    }
  };

  const stopTimer = (): void => {
    timer?.abort();
    timer = undefined;
  };

  const startTimer = (): void => {
    if (timer !== undefined) {
      return;
    }
    const controller = new AbortController();
    timer = controller;
    scheduler.sleep(limits.scheduleDelayMs, controller.signal).then(() => {
      // A sleep that resolved before stopTimer aborted it still runs this continuation; it must not
      // clear the handle of the timer that replaced it or mark that timer's delay as elapsed.
      if (timer !== controller) {
        return;
      }
      timer = undefined;
      timerDue = true;
      pump();
    }, noop);
  };

  const notifyIdle = (): void => {
    if (buffer.length > 0 || inFlight !== undefined) {
      return;
    }
    for (const resolve of idleWaiters) {
      resolve();
    }
    idleWaiters.clear();
  };

  /** Starts the next export when none is in flight and a trigger holds: a full batch, the elapsed delay, or a drain. */
  function pump(): void {
    if (inFlight !== undefined || buffer.length === 0) {
      return;
    }
    if (buffer.length < limits.maxBatchSize && !timerDue && draining === 0) {
      return;
    }
    const batch: Batch<T> = { entries: buffer.splice(0, limits.maxBatchSize), abort: new AbortController(), settled: false };
    stopTimer();
    timerDue = false;
    if (buffer.length > 0) {
      startTimer();
    }
    inFlight = batch;
    void exportBatch(batch).then(() => {
      inFlight = undefined;
      pump();
      notifyIdle();
    });
  }

  /** Drops the buffer and the batch in flight as `reason`, aborting the batch's attempt. */
  const abandon = (reason: DropReason): void => {
    stopTimer();
    timerDue = false;
    const buffered = buffer.splice(0).length;
    if (buffered > 0) {
      drop(reason, buffered);
    }
    inFlight?.abort.abort();
    settle(inFlight, reason);
  };

  /** Exports everything and resolves `true` once idle, `false` once `timeoutMs` elapses first. */
  const drain = async (timeoutMs: number): Promise<boolean> => {
    draining += 1;
    hurry.abort();
    pump();
    let onIdle = noop;
    const idle = new Promise<boolean>((resolve) => {
      onIdle = () => resolve(true);
      idleWaiters.add(onIdle);
    });
    notifyIdle();
    const deadline = new AbortController();
    const elapsed = scheduler.sleep(timeoutMs, deadline.signal).then(
      () => false,
      () => false,
    );
    try {
      return await Promise.race([idle, elapsed]);
    } finally {
      deadline.abort();
      idleWaiters.delete(onIdle);
      draining -= 1;
      if (draining === 0 && closing === undefined) {
        hurry = new AbortController();
      }
    }
  };

  return {
    enqueue(item, resource) {
      if (closing !== undefined) {
        return;
      }
      if (buffer.length >= limits.maxQueueSize) {
        drop("queue-full", 1);
        return;
      }
      buffer.push({ item, resource, observedMs: clock() });
      startTimer();
      pump();
    },
    flush(timeoutMs = limits.flushTimeoutMs) {
      return closing ?? drain(timeoutMs);
    },
    close(timeoutMs = limits.flushTimeoutMs) {
      closing ??= drain(timeoutMs).then((drained) => {
        if (!drained) {
          abandon("closed");
        }
        stopTimer();
        return drained;
      });
      return closing;
    },
  };
}
