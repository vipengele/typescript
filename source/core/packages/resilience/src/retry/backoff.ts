import { ResilienceConfigError } from "../errors";

/**
 * Maps the 1-based number of the attempt that just failed to the delay, in milliseconds, before
 * the next one. The retry policy sanitises the result, so a strategy may return any number.
 */
export type BackoffStrategy = (attempt: number) => number;

/**
 * How {@link withJitter} spreads a delay `d`: `"full"` picks uniformly from `[0, d)`, `"equal"`
 * keeps half of `d` and picks the other half uniformly, `[d / 2, d)`.
 */
export type JitterKind = "full" | "equal";

export interface ExponentialBackoffOptions {
  /** The delay after the first failed attempt; finite and at least 0. */
  readonly initialMs: number;
  /** The factor each further attempt multiplies the delay by; finite and at least 1. Defaults to 2. */
  readonly multiplier?: number;
  /** The ceiling no delay exceeds; finite and at least 0. Unbounded when omitted. */
  readonly maxMs?: number;
}

function requireFiniteAtLeast(what: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new ResilienceConfigError(`${what} expects a finite number of at least ${min}, got ${value}`);
  }
}

/**
 * Creates a {@link BackoffStrategy} that waits `ms` after every failed attempt. Throws a
 * {@link ResilienceConfigError} when `ms` is not finite or is negative.
 */
export function fixedBackoff(ms: number): BackoffStrategy {
  requireFiniteAtLeast("fixedBackoff ms", ms, 0);
  return () => ms;
}

/**
 * Creates a {@link BackoffStrategy} that waits `min(maxMs, initialMs * multiplier ** (attempt - 1))`.
 * Throws a {@link ResilienceConfigError} when `initialMs` or a given `maxMs` is not finite or is
 * negative, or when `multiplier` is not finite or is below 1.
 */
export function exponentialBackoff(options: ExponentialBackoffOptions): BackoffStrategy {
  const { initialMs, multiplier = 2, maxMs } = options;
  requireFiniteAtLeast("exponentialBackoff initialMs", initialMs, 0);
  requireFiniteAtLeast("exponentialBackoff multiplier", multiplier, 1);
  if (maxMs !== undefined) {
    requireFiniteAtLeast("exponentialBackoff maxMs", maxMs, 0);
  }
  const ceiling = maxMs ?? Number.POSITIVE_INFINITY;
  return (attempt) => Math.min(ceiling, initialMs * multiplier ** (attempt - 1));
}

/**
 * Wraps `strategy` so each delay is spread by `kind` (see {@link JitterKind}), drawing from
 * `random`, which returns a number in `[0, 1)` like `Math.random`. Throws a
 * {@link ResilienceConfigError} for an unknown `kind`.
 */
export function withJitter(strategy: BackoffStrategy, kind: JitterKind, random: () => number = Math.random): BackoffStrategy {
  if (kind === "full") {
    return (attempt) => random() * strategy(attempt);
  }
  if (kind === "equal") {
    return (attempt) => {
      const half = strategy(attempt) / 2;
      return half + random() * half;
    };
  }
  throw new ResilienceConfigError(`withJitter expects a kind of "full" or "equal", got ${String(kind)}`);
}
