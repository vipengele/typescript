import type { Clock } from "@vipengele/ts-core-common";
import type { Outcome, PolicyKind, ResilienceRegistry } from "@vipengele/ts-core-resilience";
import { HttpConfigError } from "../errors/http-errors";
import type { Filter } from "../filter";
import { bulkheadFilter } from "./bulkhead-filter";
import { circuitBreakerFilter } from "./circuit-breaker-filter";
import { rateLimiterFilter } from "./rate-limiter-filter";
import { retryFilter } from "./retry-filter";
import { timeoutFilter } from "./timeout-filter";

export interface ResilienceFilterOptions {
  /** The kinds to build filters for, in any order; defaults to those the registry configures or holds for the name. */
  kinds?: readonly PolicyKind[];
  /** Whether `outcome` is a failure, for the retry and the circuit breaker. Defaults to `defaultIsFailure`. */
  isFailure?(outcome: Outcome<unknown>): boolean;
  /** The time the retry measures an HTTP-date `Retry-After` from. Defaults to `systemClock`. */
  clock?: Clock;
  /** The longest `Retry-After` delay the retry waits for. Defaults to 30 000 ms. */
  maxRetryAfterMs?: number;
}

/** @internal The names of every filter {@link resilienceFilters} can return, one per policy kind, in band order. */
export const RESILIENCE_FILTER_NAMES: readonly string[] = Object.freeze([
  "retry",
  "circuit-breaker",
  "rate-limiter",
  "timeout",
  "bulkhead",
]);

/**
 * One filter per policy kind `registry.kinds(name, …)` gives, each running its kind's policy called
 * `name`, in band order (retry, circuit breaker, rate limiter, timeout, bulkhead), which is the
 * registry's pipeline order. The kinds are read and the policies resolved through the registry's
 * getters once, here, not per request.
 *
 * `options.isFailure` reaches the retry and the circuit breaker; `options.clock` and
 * `options.maxRetryAfterMs` reach the retry.
 *
 * @throws HttpConfigError when no kind is configured or created for `name`.
 * @throws ResilienceConfigError, as the registry raises it, for an invalid name, kinds or config. A
 *   policy created before the failing one stays in the registry.
 */
export function resilienceFilters(registry: ResilienceRegistry, name: string, options: ResilienceFilterOptions = {}): Filter[] {
  const { kinds: requested, isFailure, clock, maxRetryAfterMs } = options;
  const kinds = registry.kinds(name, requested === undefined ? undefined : { kinds: requested });
  if (kinds.length === 0) {
    throw new HttpConfigError(`No resilience policy called "${name}" is configured or created in the registry`);
  }
  const build: { readonly [K in PolicyKind]: () => Filter } = {
    retry: () => retryFilter(registry.retry(name), { isFailure, clock, maxRetryAfterMs }),
    circuitBreaker: () => circuitBreakerFilter(registry.circuitBreaker(name), { isFailure }),
    rateLimiter: () => rateLimiterFilter(registry.rateLimiter(name)),
    timeout: () => timeoutFilter(registry.timeout(name)),
    bulkhead: () => bulkheadFilter(registry.bulkhead(name)),
  };
  return kinds.map((kind) => build[kind]());
}
