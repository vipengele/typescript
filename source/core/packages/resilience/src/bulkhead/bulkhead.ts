import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import { BulkheadFullError, type BulkheadFullErrorDetails } from "../errors";
import { createEmitter, type Emitter } from "../listenable";
import type { ExecuteOptions, ExecutionContext, Listenable, Policy } from "../types";
import { type BulkheadConfig, type BulkheadDeps, validateBulkheadConfig } from "./config";

export type { BulkheadConfig, BulkheadDeps } from "./config";

/** Emitted after `execute` refused a call: no permit and no queue place was free, or a queued call waited too long. */
export interface BulkheadRejectedEvent {
  readonly kind: "bulkhead-rejected";
  readonly name: string;
  /** The clock's epoch milliseconds when the call was refused. */
  readonly at: number;
  readonly reason: BulkheadFullErrorDetails["reason"];
}

export type BulkheadEvent = BulkheadRejectedEvent;

export interface BulkheadPolicy extends Policy {
  readonly events: Listenable<BulkheadEvent>;
  /** The permits not held by a running call: `maxConcurrent` minus the calls running now. */
  readonly available: number;
}

/** A call waiting in the queue for a permit. */
interface Waiter {
  readonly signal: AbortSignal;
  /** Cancels the waiter's `maxWaitMs` sleep. */
  readonly sleeper: AbortController;
  readonly onAbort: () => void;
  readonly grant: () => void;
  readonly fail: (error: unknown) => void;
}

interface Bulkhead {
  readonly name: string;
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly maxWaitMs: number | undefined;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly emitter: Emitter<BulkheadEvent>;
  /** Calls holding a permit; a permit handed to a waiter stays counted. */
  running: number;
  /** Waiting calls, oldest first. */
  readonly queue: Waiter[];
}

function noop(): void {}

function refuse(bulkhead: Bulkhead, reason: BulkheadFullErrorDetails["reason"]): BulkheadFullError {
  const { name, maxConcurrent, maxQueue, maxWaitMs } = bulkhead;
  const message =
    reason === "full"
      ? `Bulkhead "${name}" refused the call: all ${maxConcurrent} permits are taken and its queue of ${maxQueue} is full`
      : `Bulkhead "${name}" refused the call: no permit came free within the ${maxWaitMs}ms it may wait`;
  const error = new BulkheadFullError(message, { bulkhead: name, reason });
  bulkhead.emitter.emit({ kind: "bulkhead-rejected", name, at: bulkhead.clock(), reason });
  return error;
}

/** Stops listening for the waiter's abort and cancels its wait sleep, so neither outlives its time in the queue. */
function detach(waiter: Waiter): void {
  waiter.signal.removeEventListener("abort", waiter.onAbort);
  waiter.sleeper.abort();
}

/**
 * Takes `waiter` out of the queue and rejects it with `error`. Returns `false`, doing nothing,
 * when the waiter has already left or been granted a permit: a scheduler may resolve a sleep
 * whose abort came too late to cancel it.
 */
function leave(bulkhead: Bulkhead, waiter: Waiter, error: () => unknown): boolean {
  const index = bulkhead.queue.indexOf(waiter);
  if (index === -1) {
    return false;
  }
  bulkhead.queue.splice(index, 1);
  detach(waiter);
  waiter.fail(error());
  return true;
}

/**
 * Queues the caller until a released permit is handed to it. Its signal aborting rejects with
 * the signal's reason; `maxWaitMs`, when set, elapsing rejects with a "wait-timeout"
 * {@link BulkheadFullError}. Either way the waiter leaves the queue at once.
 */
function enqueue(bulkhead: Bulkhead, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      signal,
      sleeper: new AbortController(),
      onAbort: () => leave(bulkhead, waiter, () => signal.reason),
      grant: resolve,
      fail: reject,
    };
    bulkhead.queue.push(waiter);
    signal.addEventListener("abort", waiter.onAbort, { once: true });
    if (bulkhead.maxWaitMs !== undefined) {
      bulkhead.scheduler
        .sleep(bulkhead.maxWaitMs, waiter.sleeper.signal)
        .then(() => leave(bulkhead, waiter, () => refuse(bulkhead, "wait-timeout")))
        .catch(noop);
    }
  });
}

/**
 * Takes a free permit and returns `undefined`, or queues the caller and returns the wait for
 * its permit. Throws a "full" {@link BulkheadFullError} when neither a permit nor a queue place
 * is free. The queue only holds waiters while every permit is taken, so a free permit never
 * jumps ahead of one.
 */
function admit(bulkhead: Bulkhead, signal: AbortSignal): Promise<void> | undefined {
  if (bulkhead.running < bulkhead.maxConcurrent) {
    bulkhead.running += 1;
    return undefined;
  }
  if (bulkhead.queue.length < bulkhead.maxQueue) {
    return enqueue(bulkhead, signal);
  }
  throw refuse(bulkhead, "full");
}

/** Hands the permit to the oldest waiter, keeping `running` unchanged, or frees it when nobody waits. */
function release(bulkhead: Bulkhead): void {
  const next = bulkhead.queue.shift();
  if (next === undefined) {
    bulkhead.running -= 1;
    return;
  }
  detach(next);
  next.grant();
}

/**
 * A caller signal aborted up front rejects with its reason before admission. Admission happens
 * before the first `await`, so calls made in one synchronous burst take permits or queue places
 * in the order they were made. The permit is held until `op` settles, however it settles; an
 * abort of the caller's signal reaches `op` but does not release the permit early.
 */
async function run<T>(bulkhead: Bulkhead, op: (ctx: ExecutionContext) => Promise<T> | T, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const waiting = admit(bulkhead, signal);
  if (waiting !== undefined) {
    await waiting;
  }
  try {
    return await op({ attempt: 1, signal });
  } finally {
    release(bulkhead);
  }
}

function createState(name: string, config: BulkheadConfig, deps: BulkheadDeps): Bulkhead {
  return {
    name,
    maxConcurrent: config.maxConcurrent,
    maxQueue: config.maxQueue ?? 0,
    maxWaitMs: config.maxWaitMs,
    clock: deps.clock ?? systemClock,
    scheduler: deps.scheduler ?? systemScheduler,
    emitter: createEmitter<BulkheadEvent>(),
    running: 0,
    queue: [],
  };
}

/**
 * Creates a {@link BulkheadPolicy} running at most `config.maxConcurrent` calls at once. A call
 * that finds every permit taken waits in a queue of up to `config.maxQueue` places, for at most
 * `config.maxWaitMs` when set, and a released permit goes to the oldest waiter. A call with no
 * free permit and no free queue place, or one that waited too long, rejects with a
 * {@link BulkheadFullError}. Throws a {@link ResilienceConfigError} for an empty `name` or a
 * `config` outside the documented ranges.
 */
export function createBulkhead(name: string, config: BulkheadConfig, deps: BulkheadDeps = {}): BulkheadPolicy {
  validateBulkheadConfig(name, config);
  const bulkhead = createState(name, config, deps);
  return {
    name,
    events: bulkhead.emitter.listenable,
    get available() {
      return bulkhead.maxConcurrent - bulkhead.running;
    },
    execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T> {
      return run(bulkhead, op, options?.signal ?? new AbortController().signal);
    },
  };
}
