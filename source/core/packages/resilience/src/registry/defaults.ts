import { fixedBackoff } from "../retry";
import type { ConfigOf, PolicyKind } from "./types";

function deepFreeze<T>(value: T): T {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** The config a policy takes from a registry when no layer sets a field; resilience4j's defaults. */
export const builtInDefaults: { readonly [K in PolicyKind]: ConfigOf<K> } = deepFreeze({
  retry: { maxAttempts: 3, backoff: fixedBackoff(500) },
  circuitBreaker: {
    failureRateThreshold: 50,
    slidingWindow: { type: "count", size: 100 },
    minimumCalls: 100,
    waitDurationInOpenMs: 60_000,
    permittedCallsInHalfOpen: 10,
  },
  rateLimiter: { limitForPeriod: 50, refreshPeriodMs: 500, maxWaitMs: 5_000 },
  timeout: { durationMs: 1_000 },
  bulkhead: { maxConcurrent: 25 },
});
