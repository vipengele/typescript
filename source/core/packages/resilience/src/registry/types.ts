import type { BulkheadConfig, BulkheadEvent, BulkheadPolicy } from "../bulkhead";
import type { CircuitBreakerConfig, CircuitBreakerEvent, CircuitBreakerPolicy } from "../circuit-breaker";
import type { RateLimiterConfig, RateLimiterEvent, RateLimiterPolicy } from "../rate-limiter";
import type { RetryConfig, RetryEvent, RetryPolicy } from "../retry";
import type { TimeoutConfig, TimeoutEvent, TimeoutPolicy } from "../timeout";

/** The kinds of policy a registry creates. */
export type PolicyKind = "retry" | "circuitBreaker" | "rateLimiter" | "timeout" | "bulkhead";

interface ConfigByKind {
  readonly retry: RetryConfig;
  readonly circuitBreaker: CircuitBreakerConfig;
  readonly rateLimiter: RateLimiterConfig;
  readonly timeout: TimeoutConfig;
  readonly bulkhead: BulkheadConfig;
}

interface PolicyByKind {
  readonly retry: RetryPolicy;
  readonly circuitBreaker: CircuitBreakerPolicy;
  readonly rateLimiter: RateLimiterPolicy;
  readonly timeout: TimeoutPolicy;
  readonly bulkhead: BulkheadPolicy;
}

/** The config the factory for policy kind `K` takes. */
export type ConfigOf<K extends PolicyKind> = ConfigByKind[K];

/** The policy the factory for policy kind `K` returns. */
export type PolicyOf<K extends PolicyKind> = PolicyByKind[K];

/** An event any registry-created policy emits. */
export type ResilienceEvent = RetryEvent | CircuitBreakerEvent | RateLimiterEvent | TimeoutEvent | BulkheadEvent;

/** One layer of registry configuration: per-kind defaults and per-name overrides, both partial. */
export interface RegistryBuilderLayer {
  readonly defaults?: { readonly [K in PolicyKind]?: Partial<ConfigOf<K>> };
  readonly configure?: { readonly [K in PolicyKind]?: Readonly<Record<string, Partial<ConfigOf<K>>>> };
}
