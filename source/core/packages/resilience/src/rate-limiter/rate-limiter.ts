import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import { RateLimitExceededError } from "../errors";
import { createEmitter, type Emitter } from "../listenable";
import type { ExecuteOptions, ExecutionContext, Listenable, Policy } from "../types";
import { type RateLimiterConfig, type RateLimiterDeps, validateRateLimiterConfig } from "./config";

export type { RateLimiterConfig, RateLimiterDeps } from "./config";

/** Emitted after `execute` refused a call whose permits would not be free within `maxWaitMs`. */
export interface RateLimitExceededEvent {
  readonly kind: "rate-limit-exceeded";
  readonly name: string;
  /** The clock's epoch milliseconds when the call was refused. */
  readonly at: number;
  readonly permits: number;
  /** Milliseconds until the requested permits would have been free. */
  readonly retryAfterMs: number;
}

/** Emitted after a call that waited for its permits was granted them. */
export interface RateLimitWaitedEvent {
  readonly kind: "rate-limit-waited";
  readonly name: string;
  /** The clock's epoch milliseconds when the wait ended. */
  readonly at: number;
  readonly permits: number;
  /** The wait planned when the permits were reserved. */
  readonly waitMs: number;
}

export type RateLimiterEvent = RateLimitExceededEvent | RateLimitWaitedEvent;

export interface RateLimiterPolicy extends Policy {
  readonly events: Listenable<RateLimiterEvent>;
  /**
   * Takes `permits` at once when that many are free and returns whether it did; it never waits
   * and never takes permits a waiting call has reserved. Returns `false` for more permits than
   * `burst`, and throws a `RangeError` when `permits` is not an integer of at least 1.
   */
  tryAcquire(permits?: number): boolean;
}

interface Limiter {
  readonly name: string;
  readonly limitForPeriod: number;
  readonly refreshPeriodMs: number;
  readonly maxWaitMs: number;
  readonly burst: number;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly emitter: Emitter<RateLimiterEvent>;
  /** The clock reading refresh periods are counted from. */
  readonly start: number;
  /** The newest refresh period the free permits account for; never decreases. */
  cycle: number;
  /** Free permits net of every reservation; negative while waiting calls hold permits not yet refilled. */
  permits: number;
}

/**
 * Adds `limitForPeriod` permits for every refresh period passed since the last one accounted
 * for, capped at `burst`. The period index never decreases, so a clock stepping back adds
 * nothing and stepping forward again does not refill the same periods twice.
 */
function refill(limiter: Limiter, now: number): void {
  const cycle = Math.max(limiter.cycle, Math.floor((now - limiter.start) / limiter.refreshPeriodMs));
  limiter.permits = Math.min(limiter.burst, limiter.permits + (cycle - limiter.cycle) * limiter.limitForPeriod);
  limiter.cycle = cycle;
}

/**
 * Milliseconds from `now` until the first period boundary whose refills cover `permits` on top
 * of the current balance, reservations included. `permits` is at most `burst`, so the cap never
 * keeps the balance below it once enough periods have passed.
 */
function waitFor(limiter: Limiter, permits: number, now: number): number {
  const periods = Math.ceil((permits - limiter.permits) / limiter.limitForPeriod);
  return limiter.start + (limiter.cycle + periods) * limiter.refreshPeriodMs - now;
}

/** The free permits never exceed `burst`, so a request for more than `burst` is always refused. */
function tryTake(limiter: Limiter, permits: number): boolean {
  refill(limiter, limiter.clock());
  if (limiter.permits < permits) {
    return false;
  }
  limiter.permits -= permits;
  return true;
}

function refuse(limiter: Limiter, permits: number, retryAfterMs: number): RateLimitExceededError {
  const { name, maxWaitMs } = limiter;
  const error = new RateLimitExceededError(
    `Rate limiter "${name}" refused the call: its permit is free in ${retryAfterMs}ms, beyond the ${maxWaitMs}ms it may wait`,
    { limiter: name, permits, retryAfterMs },
  );
  limiter.emitter.emit({ kind: "rate-limit-exceeded", name, at: limiter.clock(), permits, retryAfterMs });
  return error;
}

/**
 * Takes `permits` now, or reserves them and returns the wait until they are due. Throws a
 * {@link RateLimitExceededError}, reserving nothing, when that wait is longer than `maxWaitMs`.
 * Reserving drives the balance negative, so every later call is due no sooner: calls are
 * served in arrival order.
 */
function admit(limiter: Limiter, permits: number): number {
  const now = limiter.clock();
  refill(limiter, now);
  if (limiter.permits >= permits) {
    limiter.permits -= permits;
    return 0;
  }
  const waitMs = waitFor(limiter, permits, now);
  if (waitMs > limiter.maxWaitMs) {
    throw refuse(limiter, permits, waitMs);
  }
  limiter.permits -= permits;
  return waitMs;
}

/**
 * Sleeps until reserved permits are due. An abort returns them, capped at `burst`, and rejects
 * with the signal's reason; other sleepers keep their due instants, and the returned permits go
 * to whoever arrives next.
 */
async function wait(limiter: Limiter, permits: number, waitMs: number, signal: AbortSignal): Promise<void> {
  try {
    await limiter.scheduler.sleep(waitMs, signal);
  } catch (error) {
    limiter.permits = Math.min(limiter.burst, limiter.permits + permits);
    throw error;
  }
  limiter.emitter.emit({ kind: "rate-limit-waited", name: limiter.name, at: limiter.clock(), permits, waitMs });
}

/**
 * A caller signal aborted up front rejects with its reason before admission. Admission happens
 * before the first `await`, so calls made in one synchronous burst take or reserve permits in
 * the order they were made.
 */
async function run<T>(limiter: Limiter, op: (ctx: ExecutionContext) => Promise<T> | T, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const waitMs = admit(limiter, 1);
  if (waitMs > 0) {
    await wait(limiter, 1, waitMs, signal);
  }
  return op({ attempt: 1, signal });
}

function createLimiter(name: string, config: RateLimiterConfig, deps: RateLimiterDeps): Limiter {
  const clock = deps.clock ?? systemClock;
  return {
    name,
    limitForPeriod: config.limitForPeriod,
    refreshPeriodMs: config.refreshPeriodMs,
    maxWaitMs: config.maxWaitMs,
    burst: config.burst ?? config.limitForPeriod,
    clock,
    scheduler: deps.scheduler ?? systemScheduler,
    emitter: createEmitter<RateLimiterEvent>(),
    start: clock(),
    cycle: 0,
    permits: config.limitForPeriod,
  };
}

/**
 * Creates a {@link RateLimiterPolicy} handing out `config.limitForPeriod` permits per
 * `config.refreshPeriodMs`, counted in whole periods from creation. It starts with
 * `limitForPeriod` free permits, and unused ones carry over up to `config.burst`. `execute`
 * takes one permit, waiting up to `config.maxWaitMs` for it, and otherwise rejects at once with a
 * {@link RateLimitExceededError} whose `retryAfterMs` is the wait it would have needed. Throws a
 * {@link ResilienceConfigError} for an empty `name` or a `config` outside the documented ranges.
 */
export function createRateLimiter(name: string, config: RateLimiterConfig, deps: RateLimiterDeps = {}): RateLimiterPolicy {
  validateRateLimiterConfig(name, config);
  const limiter = createLimiter(name, config, deps);
  return {
    name,
    events: limiter.emitter.listenable,
    tryAcquire(permits = 1) {
      if (!(Number.isInteger(permits) && permits >= 1)) {
        throw new RangeError(`Rate limiter "${name}" expects permits to be an integer of at least 1, got ${permits}`);
      }
      return tryTake(limiter, permits);
    },
    execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T> {
      return run(limiter, op, options?.signal ?? new AbortController().signal);
    },
  };
}
