import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import { DURATION_CONSTRAINT, isDuration, isIntegerAtLeastOne, reject as rejectConfig } from "../config-validation";
import { ResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";

/** How many permits a rate limiter hands out per refresh period, how many it saves up, and how long a call may wait. */
export interface RateLimiterConfig {
  /** The permits each refresh period adds; an integer of at least 1. */
  readonly limitForPeriod: number;
  /** The length of one refresh period; finite, above 0 and at most {@link MAX_TIMEOUT_DURATION_MS}. */
  readonly refreshPeriodMs: number;
  /**
   * How long `execute` may wait for a permit; finite, at least 0 and at most
   * {@link MAX_TIMEOUT_DURATION_MS}. `0` refuses at once whenever no permit is free.
   */
  readonly maxWaitMs: number;
  /**
   * The most permits unused periods may save up; an integer of at least `limitForPeriod`, which
   * is also its default. At the default each period resets the free permits to `limitForPeriod`.
   */
  readonly burst?: number;
}

/** The injectable collaborators of a rate limiter. */
export interface RateLimiterDeps {
  /** Counts refresh periods from creation and stamps each event's `at`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the wait for a permit not yet free; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
}

const LABEL = "Rate limiter";

function reject(name: string, key: string, constraint: string, value: unknown): never {
  return rejectConfig(LABEL, name, key, constraint, value);
}

function isWait(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_TIMEOUT_DURATION_MS;
}

function validateBurst(name: string, limitForPeriod: number, burst: number | undefined): void {
  if (burst !== undefined && !(Number.isInteger(burst) && burst >= limitForPeriod)) {
    reject(name, "burst", `an integer of at least limitForPeriod ${limitForPeriod}`, burst);
  }
}

/**
 * Throws a {@link ResilienceConfigError} for an empty `name` or a `config` outside the ranges its
 * fields document. A `burst` below `limitForPeriod` is rejected rather than raised to it.
 */
export function validateRateLimiterConfig(name: string, config: RateLimiterConfig): void {
  if (name === "") {
    throw new ResilienceConfigError("A rate limiter needs a non-empty name");
  }
  const { limitForPeriod, refreshPeriodMs, maxWaitMs, burst } = config;
  if (!isIntegerAtLeastOne(limitForPeriod)) {
    reject(name, "limitForPeriod", "an integer of at least 1", limitForPeriod);
  }
  if (!isDuration(refreshPeriodMs)) {
    reject(name, "refreshPeriodMs", DURATION_CONSTRAINT, refreshPeriodMs);
  }
  if (!isWait(maxWaitMs)) {
    reject(name, "maxWaitMs", `finite, at least 0 and at most ${MAX_TIMEOUT_DURATION_MS}`, maxWaitMs);
  }
  validateBurst(name, limitForPeriod, burst);
}
