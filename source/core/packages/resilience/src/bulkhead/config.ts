import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import { DURATION_CONSTRAINT, isDuration, isIntegerAtLeastOne, reject as rejectConfig } from "../config-validation";
import { ResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";

/** How many calls a bulkhead runs at once, how many it queues, and how long a queued call may wait. */
export interface BulkheadConfig {
  /** The calls that may run at once; an integer of at least 1. */
  readonly maxConcurrent: number;
  /**
   * The calls that may wait for a permit; an integer of at least 0, default 0. At 0 a call that
   * finds every permit taken is refused at once.
   */
  readonly maxQueue?: number;
  /**
   * How long a queued call may wait for a permit; finite, above 0 and at most
   * {@link MAX_TIMEOUT_DURATION_MS}. Unset, a queued call waits until it gets a permit or its
   * signal aborts. Setting it with `maxQueue` 0 is rejected: nothing would ever wait.
   */
  readonly maxWaitMs?: number;
}

/** The injectable collaborators of a bulkhead. */
export interface BulkheadDeps {
  /** Stamps each event's `at`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies a queued call's `maxWaitMs` wait; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
}

const LABEL = "Bulkhead";

function reject(name: string, key: string, constraint: string, value: unknown): never {
  return rejectConfig(LABEL, name, key, constraint, value);
}

function validateMaxWait(name: string, maxQueue: number, maxWaitMs: number | undefined): void {
  if (maxWaitMs === undefined) {
    return;
  }
  if (!isDuration(maxWaitMs)) {
    reject(name, "maxWaitMs", DURATION_CONSTRAINT, maxWaitMs);
  }
  if (maxQueue === 0) {
    reject(name, "maxWaitMs", "unset while maxQueue is 0", maxWaitMs);
  }
}

/**
 * Throws a {@link ResilienceConfigError} for an empty `name`, a `config` outside the ranges its
 * fields document, or a `maxWaitMs` given while `maxQueue` is 0, explicitly or by default.
 */
export function validateBulkheadConfig(name: string, config: BulkheadConfig): void {
  if (name === "") {
    throw new ResilienceConfigError("A bulkhead needs a non-empty name");
  }
  const { maxConcurrent, maxQueue = 0, maxWaitMs } = config;
  if (!isIntegerAtLeastOne(maxConcurrent)) {
    reject(name, "maxConcurrent", "an integer of at least 1", maxConcurrent);
  }
  if (!(Number.isInteger(maxQueue) && maxQueue >= 0)) {
    reject(name, "maxQueue", "an integer of at least 0", maxQueue);
  }
  validateMaxWait(name, maxQueue, maxWaitMs);
}
