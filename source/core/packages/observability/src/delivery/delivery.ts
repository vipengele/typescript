import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { type BackoffStrategy, createRetry, exponentialBackoff, type Outcome, withJitter } from "@vipengele/ts-core-resilience/retry";
import { createTimeout } from "@vipengele/ts-core-resilience/timeout";
import { classifyStatus, parseRetryAfter } from "./retry-policy";
import { detectLifecycleTargets, type LifecycleTargets, largestFittingPrefix, UNLOAD_BUDGET_BYTES, watchUnload } from "./unload";

/**
 * Why entries left the delivery without reaching the collector:
 *
 * - `"queue-full"` — the buffer held `maxQueueSize` entries; the newest one is dropped.
 * - `"rejected"` — the collector answered with a status that is not retried, or the batch could
 *   not be sent at all: `encode` threw, the `headers` thunk threw, or `fetch` threw synchronously.
 * - `"retries-exhausted"` — every attempt failed with a network error, a timeout or a retryable status.
 * - `"closed"` — still buffered or in flight when `close` ran out of time.
 * - `"unload-budget"` — left over, past the keepalive budget, when the page was hidden or unloaded.
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
  /** Set on the one request sent as the page is hidden or unloaded, so it outlives the page. */
  readonly keepalive?: boolean;
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
  /**
   * Where `pagehide` and `visibilitychange` arrive. Omitted, they are detected on `globalThis`
   * (`detectLifecycleTargets`); given, exactly these are watched, so `{}` watches none.
   */
  readonly lifecycle?: LifecycleTargets;
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
   * a no-op. Stops watching for the page being hidden or unloaded once the flush is over. Resolves as the flush did; a second call returns the first call's promise. Never rejects.
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

/** Fills every limit `given` leaves out from {@link DEFAULT_DELIVERY_LIMITS}. */
function resolveLimits(given: Partial<DeliveryLimits> = {}): DeliveryLimits {
  return {
    maxQueueSize: given.maxQueueSize ?? DEFAULT_DELIVERY_LIMITS.maxQueueSize,
    maxBatchSize: given.maxBatchSize ?? DEFAULT_DELIVERY_LIMITS.maxBatchSize,
    scheduleDelayMs: given.scheduleDelayMs ?? DEFAULT_DELIVERY_LIMITS.scheduleDelayMs,
    maxAttempts: given.maxAttempts ?? DEFAULT_DELIVERY_LIMITS.maxAttempts,
    attemptTimeoutMs: given.attemptTimeoutMs ?? DEFAULT_DELIVERY_LIMITS.attemptTimeoutMs,
    flushTimeoutMs: given.flushTimeoutMs ?? DEFAULT_DELIVERY_LIMITS.flushTimeoutMs,
  };
}

/** The headers of one request: the configured ones, the thunk run once, and `content-type` always `application/json`. */
function requestHeaders(options: Pick<DeliveryOptions<unknown>, "headers">): Record<string, string> {
  const configured = typeof options.headers === "function" ? options.headers() : options.headers;
  return { ...configured, "content-type": "application/json" };
}

/** How a batch whose last attempt answered `status` ended: delivered, or dropped for the returned reason. */
function dropReasonOf(status: number): DropReason | undefined {
  const verdict = classifyStatus(status);
  if (verdict === "delivered") {
    return undefined;
  }
  return verdict === "retryable" ? "retries-exhausted" : "rejected";
}

/** The state machine behind {@link createDelivery}: the buffer, the batch in flight, the schedule-delay timer and the drains. */
class DeliveryQueue<T> {
  readonly #options: DeliveryOptions<T>;
  readonly #limits: DeliveryLimits;
  readonly #fetch: DeliveryFetch;
  readonly #clock: Clock;
  readonly #scheduler: Scheduler;
  readonly #onDrop: (reason: DropReason, count: number) => void;
  readonly #retry: ReturnType<typeof createRetry>;
  readonly #timeout: ReturnType<typeof createTimeout>;
  readonly #unwatch: () => void;

  readonly #buffer: DeliveryEntry<T>[] = [];
  #inFlight: Batch<T> | undefined;
  /** Aborts the pending schedule-delay sleep; set while one is pending. */
  #timer: AbortController | undefined;
  /** The schedule delay elapsed while a batch was in flight; the next export is owed. */
  #timerDue = false;
  /** How many `flush`/`close` calls are waiting; while above 0, anything buffered is exported at once. */
  #draining = 0;
  /** Aborted while draining: a backoff sleep in progress ends, and one starting is skipped. */
  #hurry = new AbortController();
  #closing: Promise<boolean> | undefined;
  readonly #idleWaiters = new Set<() => void>();

  constructor(options: DeliveryOptions<T>, limits: DeliveryLimits) {
    this.#options = options;
    this.#limits = limits;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#clock = options.clock ?? systemClock;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#onDrop = options.onDrop ?? noop;
    this.#retry = createRetry(
      "vipengele.delivery",
      {
        maxAttempts: limits.maxAttempts,
        backoff: options.backoff ?? withJitter(exponentialBackoff({ initialMs: 1000, maxMs: 30_000 }), "full"),
        shouldRetry: retryable,
        retryAfter: retryAfterOf,
      },
      { clock: this.#clock, scheduler: this.#backoffScheduler() },
    );
    this.#timeout = createTimeout(
      "vipengele.delivery.attempt",
      { durationMs: limits.attemptTimeoutMs },
      { clock: this.#clock, scheduler: this.#scheduler },
    );
    this.#unwatch = watchUnload(options.lifecycle ?? detectLifecycleTargets(), () => this.#unloadDrain());
  }

  enqueue(item: T, resource: Resource): void {
    if (this.#closing !== undefined) {
      return;
    }
    if (this.#buffer.length >= this.#limits.maxQueueSize) {
      this.#drop("queue-full", 1);
      return;
    }
    this.#buffer.push({ item, resource, observedMs: this.#clock() });
    this.#startTimer();
    this.#pump();
  }

  flush(timeoutMs = this.#limits.flushTimeoutMs): Promise<boolean> {
    return this.#closing ?? this.#drain(timeoutMs);
  }

  close(timeoutMs = this.#limits.flushTimeoutMs): Promise<boolean> {
    this.#closing ??= this.#drain(timeoutMs).then((drained) => {
      if (!drained) {
        this.#abandon("closed");
      }
      this.#stopTimer();
      this.#unwatch();
      return drained;
    });
    return this.#closing;
  }

  #drop(reason: DropReason, count: number): void {
    const onDrop = this.#onDrop;
    try {
      onDrop(reason, count);
    } catch {
      // onDrop is the host's observer; its failure is not the delivery's to report.
    }
  }

  /** Records how `batch` ended; a batch that already settled, or none at all, ignores the report. */
  #settle(batch: Batch<T> | undefined, reason: DropReason | undefined): void {
    if (batch === undefined || batch.settled) {
      return;
    }
    batch.settled = true;
    if (reason !== undefined) {
      this.#drop(reason, batch.entries.length);
    }
  }

  /**
   * The scheduler the retry waits on: a backoff ends early, resolving rather than rejecting, when
   * `hurry` or the retry's own signal aborts, and is skipped while `hurry` is already aborted. An
   * aborted batch still stops: its next attempt rejects before `fetch` is called, since the attempt
   * timeout checks the signal first, and the retry then rejects with the signal's reason.
   */
  #backoffScheduler(): Scheduler {
    return {
      sleep: async (ms, signal = new AbortController().signal) => {
        const hurried = this.#hurry.signal;
        if (hurried.aborted) {
          return;
        }
        await this.#scheduler.sleep(ms, AbortSignal.any([signal, hurried])).catch(noop);
      },
    };
  }

  /** One POST. A synchronous throw from `fetch` gives `unsent`; a rejection fails the attempt. */
  async #attempt(request: Omit<DeliveryRequest, "signal">, signal: AbortSignal): Promise<AttemptResult> {
    const doFetch = this.#fetch;
    let pending: Promise<DeliveryResponse>;
    try {
      pending = doFetch(this.#options.url, { ...request, signal });
    } catch {
      return UNSENT;
    }
    const response = await pending;
    response.body?.cancel().catch(noop);
    return { kind: "status", status: response.status, retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), this.#clock()) };
  }

  async #exportBatch(batch: Batch<T>): Promise<void> {
    const { encode } = this.#options;
    let request: Omit<DeliveryRequest, "signal">;
    try {
      request = { method: "POST", headers: requestHeaders(this.#options), body: encode(batch.entries) };
    } catch {
      this.#settle(batch, "rejected");
      return;
    }
    try {
      const result = await this.#retry.execute(
        (ctx) => this.#timeout.execute(({ signal }) => this.#attempt(request, signal), { signal: ctx.signal }),
        { signal: batch.abort.signal },
      );
      this.#settle(batch, result.kind === "unsent" ? "rejected" : dropReasonOf(result.status));
    } catch {
      this.#settle(batch, "retries-exhausted");
    }
  }

  #stopTimer(): void {
    this.#timer?.abort();
    this.#timer = undefined;
  }

  #startTimer(): void {
    if (this.#timer !== undefined) {
      return;
    }
    const controller = new AbortController();
    this.#timer = controller;
    this.#scheduler.sleep(this.#limits.scheduleDelayMs, controller.signal).then(() => this.#timerElapsed(controller), noop);
  }

  #timerElapsed(controller: AbortController): void {
    // A sleep that resolved before stopTimer aborted it still runs this continuation; it must not
    // clear the handle of the timer that replaced it or mark that timer's delay as elapsed.
    if (this.#timer !== controller) {
      return;
    }
    this.#timer = undefined;
    this.#timerDue = true;
    this.#pump();
  }

  #notifyIdle(): void {
    if (this.#buffer.length > 0 || this.#inFlight !== undefined) {
      return;
    }
    for (const resolve of this.#idleWaiters) {
      resolve();
    }
    this.#idleWaiters.clear();
  }

  /** Whether an export is owed now: one is not already in flight, and a trigger holds — a full batch, the elapsed delay, or a drain. */
  #exportDue(): boolean {
    if (this.#inFlight !== undefined || this.#buffer.length === 0) {
      return false;
    }
    return this.#buffer.length >= this.#limits.maxBatchSize || this.#timerDue || this.#draining > 0;
  }

  /** Starts the next export when none is in flight and a trigger holds: a full batch, the elapsed delay, or a drain. */
  #pump(): void {
    if (!this.#exportDue()) {
      return;
    }
    const batch: Batch<T> = { entries: this.#buffer.splice(0, this.#limits.maxBatchSize), abort: new AbortController(), settled: false };
    this.#stopTimer();
    this.#timerDue = false;
    if (this.#buffer.length > 0) {
      this.#startTimer();
    }
    this.#inFlight = batch;
    void this.#exportBatch(batch).then(() => {
      this.#inFlight = undefined;
      this.#pump();
      this.#notifyIdle();
    });
  }

  /** Drops the buffer and the batch in flight as `reason`, aborting the batch's attempt. */
  #abandon(reason: DropReason): void {
    this.#stopTimer();
    this.#timerDue = false;
    const buffered = this.#buffer.splice(0).length;
    if (buffered > 0) {
      this.#drop(reason, buffered);
    }
    this.#inFlight?.abort.abort();
    this.#settle(this.#inFlight, reason);
  }

  /** Exports everything and resolves `true` once idle, `false` once `timeoutMs` elapses first. */
  async #drain(timeoutMs: number): Promise<boolean> {
    this.#draining += 1;
    this.#hurry.abort();
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
      if (this.#draining === 0 && this.#closing === undefined) {
        this.#hurry = new AbortController();
      }
    }
  }

  /**
   * Takes what is in flight and buffered out of the delivery, oldest first, for the unload drain.
   * A batch in flight is settled without a reason first: its entries are accounted for by the
   * caller, and the aborted export must find the batch settled rather than report it as
   * retries-exhausted.
   */
  #takeAll(): DeliveryEntry<T>[] {
    const batch = this.#inFlight !== undefined && !this.#inFlight.settled ? this.#inFlight : undefined;
    const entries = [...(batch?.entries ?? []), ...this.#buffer];
    if (entries.length === 0) {
      return entries;
    }
    this.#stopTimer();
    this.#timerDue = false;
    this.#buffer.splice(0);
    if (batch !== undefined) {
      this.#settle(batch, undefined);
      batch.abort.abort();
    }
    return entries;
  }

  /**
   * Sends what is in flight and buffered as one keepalive request, within the keepalive budget,
   * which is shared by every keepalive request of the document, so splitting the entries over
   * several requests would only get the later ones refused. There is no `sendBeacon` fallback: a
   * beacon cannot carry the configured headers, and a cross-origin `application/json` beacon is
   * refused outright. A throw from `encode` or the `headers` thunk drops every entry as
   * `"rejected"`, as an export does. The request is not awaited and its outcome is not reported: a
   * throw or rejection from `fetch` is swallowed.
   */
  #unloadDrain(): void {
    const entries = this.#takeAll();
    if (entries.length === 0) {
      return;
    }
    let headers: Record<string, string>;
    let prefix: { count: number; body: string };
    try {
      headers = requestHeaders(this.#options);
      prefix = largestFittingPrefix(entries, this.#options.encode, UNLOAD_BUDGET_BYTES);
    } catch {
      this.#drop("rejected", entries.length);
      return;
    }
    if (prefix.count < entries.length) {
      this.#drop("unload-budget", entries.length - prefix.count);
    }
    if (prefix.count === 0) {
      return;
    }
    this.#sendKeepalive(headers, prefix.body);
  }

  #sendKeepalive(headers: Record<string, string>, body: string): void {
    const doFetch = this.#fetch;
    try {
      const request = { method: "POST", headers, body, signal: new AbortController().signal, keepalive: true } as const;
      Promise.resolve(doFetch(this.#options.url, request)).catch(noop);
    } catch {
      // A page going away leaves nobody to report a request that could not be made to.
    }
  }
}

/**
 * Creates a {@link Delivery}: a buffer of entries exported as OTLP/HTTP JSON batches, one batch in
 * flight at a time. An export starts when the buffer reaches `maxBatchSize`, or `scheduleDelayMs`
 * after the first entry reaches an empty buffer; once a batch settles, a buffer holding a full batch
 * is exported at once. A network error, a timeout, 429, 502, 503 and 504 are retried with
 * `backoff`, or after the delay a `Retry-After` names. Payload-generic: `encode` alone knows `T`.
 *
 * When the page is hidden or unloaded (`pagehide`, or `visibilitychange` to `"hidden"`), the batch
 * in flight is aborted and the oldest entries, in flight then buffered, that encode within
 * {@link UNLOAD_BUDGET_BYTES} go out as one `keepalive` request; the rest are dropped as
 * `"unload-budget"`. The delivery keeps working afterwards, for a page that comes back.
 *
 * Throws a `RangeError` when `maxQueueSize` or `maxBatchSize` is not an integer of at least 1, and
 * a `ResilienceConfigError` for an invalid `maxAttempts` or `attemptTimeoutMs`.
 */
export function createDelivery<T>(options: DeliveryOptions<T>): Delivery<T> {
  const limits = resolveLimits(options.limits);
  requirePositiveInteger("maxQueueSize", limits.maxQueueSize);
  requirePositiveInteger("maxBatchSize", limits.maxBatchSize);
  const queue = new DeliveryQueue(options, limits);
  return {
    enqueue: (item, resource) => queue.enqueue(item, resource),
    flush: (timeoutMs) => queue.flush(timeoutMs),
    close: (timeoutMs) => queue.close(timeoutMs),
  };
}
