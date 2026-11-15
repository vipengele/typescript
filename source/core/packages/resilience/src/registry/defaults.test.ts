import { describe, expect, test } from "vitest";
import { createBulkhead } from "../bulkhead";
import { createCircuitBreaker } from "../circuit-breaker";
import { createRateLimiter } from "../rate-limiter";
import { createRetry } from "../retry";
import { createTimeout } from "../timeout";
import { builtInDefaults } from "./defaults";

function expectDeeplyFrozen(value: unknown, path: string): void {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return;
  }
  expect(Object.isFrozen(value), path).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeeplyFrozen((value as Record<PropertyKey, unknown>)[key], `${path}.${String(key)}`);
  }
}

describe("builtInDefaults", () => {
  test("creates every policy through its factory", () => {
    expect(() => createRetry("r", builtInDefaults.retry)).not.toThrow();
    expect(() => createCircuitBreaker("c", builtInDefaults.circuitBreaker)).not.toThrow();
    expect(() => createRateLimiter("l", builtInDefaults.rateLimiter)).not.toThrow();
    expect(() => createTimeout("t", builtInDefaults.timeout)).not.toThrow();
    expect(() => createBulkhead("b", builtInDefaults.bulkhead)).not.toThrow();
  });

  test("is deeply frozen", () => {
    expectDeeplyFrozen(builtInDefaults, "builtInDefaults");
  });

  test("holds resilience4j's values", () => {
    expect(builtInDefaults.circuitBreaker.slidingWindow).toEqual({ type: "count", size: 100 });
    expect(builtInDefaults.retry.maxAttempts).toBe(3);
    expect(builtInDefaults.retry.backoff(1)).toBe(500);
    expect(builtInDefaults.timeout).toEqual({ durationMs: 1_000 });
    expect(builtInDefaults.bulkhead).toEqual({ maxConcurrent: 25 });
    expect(builtInDefaults.rateLimiter).toEqual({ limitForPeriod: 50, refreshPeriodMs: 500, maxWaitMs: 5_000 });
  });
});
