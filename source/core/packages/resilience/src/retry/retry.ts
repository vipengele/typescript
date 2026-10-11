import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import { isBulkheadFullError, isCircuitOpenError, isRateLimitExceededError, ResilienceConfigError } from "../errors";
import { createEmitter, type Emitter } from "../listenable";
import type { ExecuteOptions, ExecutionContext, Listenable, Outcome, Policy } from "../types";
import type { BackoffStrategy } from "./backoff";

/**
 * The largest delay `setTimeout` honours. A larger one overflows and fires almost at once, so
 * every delay is clamped to it.
 */
const MAX_DELAY_MS = 2_147_483_647;

export interface RetryConfig {
  /** How many attempts run at most, the first included; an integer of at least 1. */
  readonly maxAttempts: number;
  /** The delay before each further attempt, unless `retryAfter` names one. */
  readonly backoff: BackoffStrategy;
  /**
   * Whether `outcome` of attempt number `attempt` warrants another attempt. Defaults to retrying
   * every error except a `CircuitOpenError`, `RateLimitExceededError` or `BulkheadFullError`, and
   * never an `ok` outcome.
   */
  readonly shouldRetry?: (outcome: Outcome<unknown>, attempt: number) => boolean;
  /**
   * The delay before the next attempt, overriding `backoff` (a server's `Retry-After`, say);
   * `undefined` falls back to `backoff`.
   */
  readonly retryAfter?: (outcome: Outcome<unknown>, attempt: number) => number | undefined;
}

export interface RetryDeps {
  /** Stamps each {@link RetryEvent}'s `at`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the wait between attempts; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
}

/** Emitted after attempt `attempt` produced `outcome` and before the `delayMs` wait for the next. */
export interface RetryAttemptEvent {
  readonly kind: "retry";
  readonly name: string;
  /** The clock's epoch milliseconds when the retry was decided. */
  readonly at: number;
  readonly attempt: number;
  /** The sanitised delay actually waited. */
  readonly delayMs: number;
  readonly outcome: Outcome<unknown>;
}

/** Emitted when `shouldRetry` wanted another attempt but all `attempts` were used. */
export interface RetryExhaustedEvent {
  readonly kind: "retry-exhausted";
  readonly name: string;
  /** The clock's epoch milliseconds when the policy gave up. */
  readonly at: number;
  readonly attempts: number;
  readonly outcome: Outcome<unknown>;
}

export type RetryEvent = RetryAttemptEvent | RetryExhaustedEvent;

export interface RetryPolicy extends Policy {
  readonly events: Listenable<RetryEvent>;
}

interface RetrySettings {
  readonly name: string;
  readonly maxAttempts: number;
  readonly backoff: BackoffStrategy;
  readonly shouldRetry: (outcome: Outcome<unknown>, attempt: number) => boolean;
  readonly retryAfter: ((outcome: Outcome<unknown>, attempt: number) => number | undefined) | undefined;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly emitter: Emitter<RetryEvent>;
}

function validate(name: string, config: RetryConfig): void {
  if (name === "") {
    throw new ResilienceConfigError("A retry needs a non-empty name");
  }
  const { maxAttempts } = config;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ResilienceConfigError(`Retry "${name}" expects maxAttempts to be an integer of at least 1, got ${maxAttempts}`);
  }
}

/**
 * Retries every error except a refusal from another policy — an open circuit, an exhausted rate
 * limit or a full bulkhead — which another attempt straight away would only meet again.
 */
function defaultShouldRetry(outcome: Outcome<unknown>): boolean {
  if (outcome.ok) {
    return false;
  }
  const { error } = outcome;
  return !(isCircuitOpenError(error) || isRateLimitExceededError(error) || isBulkheadFullError(error));
}

/**
 * NaN and negative delays become 0, and a delay above {@link MAX_DELAY_MS} is clamped to it.
 * Without this an infinite delay makes the scheduler reject with a `RangeError` in place of the
 * operation's own error, and an oversized one fires at once.
 */
function sanitizeDelay(ms: number): number {
  if (!(ms > 0)) {
    return 0;
  }
  return Math.min(ms, MAX_DELAY_MS);
}

function delayFor(settings: RetrySettings, outcome: Outcome<unknown>, attempt: number): number {
  const requested = settings.retryAfter?.(outcome, attempt);
  return sanitizeDelay(requested ?? settings.backoff(attempt));
}

/** A synchronous throw from `op` is caught like a rejection, so it counts as a failed attempt. */
async function attemptOnce<T>(op: (ctx: ExecutionContext) => Promise<T> | T, ctx: ExecutionContext): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await op(ctx) };
  } catch (error) {
    return { ok: false, error };
  }
}

function settle<T>(outcome: Outcome<T>): T {
  if (outcome.ok) {
    return outcome.value;
  }
  throw outcome.error;
}

/**
 * Runs `op` until `shouldRetry` declines its outcome or `maxAttempts` is reached, settling with
 * the last outcome. The caller's signal is checked before the first attempt and after each failed
 * one, and aborts the wait between attempts; each rejects with the signal's reason.
 */
async function run<T>(settings: RetrySettings, op: (ctx: ExecutionContext) => Promise<T> | T, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await attemptOnce(op, { attempt, signal });
    if (!outcome.ok) {
      signal.throwIfAborted();
    }
    if (!settings.shouldRetry(outcome, attempt)) {
      return settle(outcome);
    }
    if (attempt >= settings.maxAttempts) {
      settings.emitter.emit({ kind: "retry-exhausted", name: settings.name, at: settings.clock(), attempts: attempt, outcome });
      return settle(outcome);
    }
    const delayMs = delayFor(settings, outcome, attempt);
    settings.emitter.emit({ kind: "retry", name: settings.name, at: settings.clock(), attempt, delayMs, outcome });
    await settings.scheduler.sleep(delayMs, signal);
  }
}

/**
 * Creates a {@link RetryPolicy} that runs an operation up to `config.maxAttempts` times, waiting
 * the backoff (or `retryAfter`'s delay) between attempts. A final error is rethrown as the very
 * value `op` threw; a final `ok` outcome resolves with its value. Throws a
 * {@link ResilienceConfigError} for an empty `name` or a `maxAttempts` that is not an integer of
 * at least 1.
 */
export function createRetry(name: string, config: RetryConfig, deps: RetryDeps = {}): RetryPolicy {
  validate(name, config);
  const settings: RetrySettings = {
    name,
    maxAttempts: config.maxAttempts,
    backoff: config.backoff,
    shouldRetry: config.shouldRetry ?? defaultShouldRetry,
    retryAfter: config.retryAfter,
    clock: deps.clock ?? systemClock,
    scheduler: deps.scheduler ?? systemScheduler,
    emitter: createEmitter<RetryEvent>(),
  };
  return {
    name,
    events: settings.emitter.listenable,
    execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T> {
      return run(settings, op, options?.signal ?? new AbortController().signal);
    },
  };
}
