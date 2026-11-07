import { describe, expect, test } from "vitest";
import { isResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";
import { type CircuitBreakerConfig, validateCircuitBreakerConfig } from "./config";

const VALID: CircuitBreakerConfig = {
  failureRateThreshold: 50,
  slidingWindow: { type: "count", size: 10 },
  minimumCalls: 5,
  waitDurationInOpenMs: 1_000,
  permittedCallsInHalfOpen: 2,
};

function withConfig(overrides: Partial<CircuitBreakerConfig>): CircuitBreakerConfig {
  return { ...VALID, ...overrides };
}

function withWindow(slidingWindow: unknown, overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return withConfig({ slidingWindow: slidingWindow as CircuitBreakerConfig["slidingWindow"], ...overrides });
}

const WAIT = `finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;
const INTEGER = "an integer of at least 1";

describe("validateCircuitBreakerConfig", () => {
  test("rejects an empty name", () => {
    expect(() => validateCircuitBreakerConfig("", VALID)).toThrow("A circuit breaker needs a non-empty name");
  });

  test.each<[string, CircuitBreakerConfig, string]>([
    [
      "zero failureRateThreshold",
      withConfig({ failureRateThreshold: 0 }),
      `failureRateThreshold to be finite, above 0 and at most 100, got 0`,
    ],
    [
      "negative failureRateThreshold",
      withConfig({ failureRateThreshold: -1 }),
      `failureRateThreshold to be finite, above 0 and at most 100, got -1`,
    ],
    [
      "failureRateThreshold above 100",
      withConfig({ failureRateThreshold: 100.5 }),
      `failureRateThreshold to be finite, above 0 and at most 100, got 100.5`,
    ],
    [
      "NaN failureRateThreshold",
      withConfig({ failureRateThreshold: Number.NaN }),
      `failureRateThreshold to be finite, above 0 and at most 100, got NaN`,
    ],
    [
      "infinite failureRateThreshold",
      withConfig({ failureRateThreshold: Number.POSITIVE_INFINITY }),
      `failureRateThreshold to be finite, above 0 and at most 100, got Infinity`,
    ],
    ["zero minimumCalls", withConfig({ minimumCalls: 0 }), `minimumCalls to be ${INTEGER}, got 0`],
    ["fractional minimumCalls", withConfig({ minimumCalls: 1.5 }), `minimumCalls to be ${INTEGER}, got 1.5`],
    ["NaN minimumCalls", withConfig({ minimumCalls: Number.NaN }), `minimumCalls to be ${INTEGER}, got NaN`],
    ["zero permittedCallsInHalfOpen", withConfig({ permittedCallsInHalfOpen: 0 }), `permittedCallsInHalfOpen to be ${INTEGER}, got 0`],
    [
      "fractional permittedCallsInHalfOpen",
      withConfig({ permittedCallsInHalfOpen: 2.5 }),
      `permittedCallsInHalfOpen to be ${INTEGER}, got 2.5`,
    ],
    ["unknown window type", withWindow({ type: "sliding", size: 10 }), `slidingWindow.type to be "count" or "time", got sliding`],
    ["zero count window size", withWindow({ type: "count", size: 0 }, { minimumCalls: 1 }), `slidingWindow.size to be ${INTEGER}, got 0`],
    ["fractional count window size", withWindow({ type: "count", size: 10.5 }), `slidingWindow.size to be ${INTEGER}, got 10.5`],
    ["zero time window size", withWindow({ type: "time", size: 0 }), `slidingWindow.size to be ${WAIT}, got 0`],
    ["negative time window size", withWindow({ type: "time", size: -5 }), `slidingWindow.size to be ${WAIT}, got -5`],
    [
      "infinite time window size",
      withWindow({ type: "time", size: Number.POSITIVE_INFINITY }),
      `slidingWindow.size to be ${WAIT}, got Infinity`,
    ],
    [
      "time window size above the timer maximum",
      withWindow({ type: "time", size: MAX_TIMEOUT_DURATION_MS + 1 }),
      `slidingWindow.size to be ${WAIT}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
    [
      "count window smaller than minimumCalls",
      withWindow({ type: "count", size: 4 }),
      `minimumCalls to be at most the count window size 4, got 5`,
    ],
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    ["zero waitDurationInOpenMs", withConfig({ waitDurationInOpenMs: 0 }), `waitDurationInOpenMs to be ${WAIT}, got 0`],
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    ["NaN waitDurationInOpenMs", withConfig({ waitDurationInOpenMs: Number.NaN }), `waitDurationInOpenMs to be ${WAIT}, got NaN`],
    [
      // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
      "waitDurationInOpenMs above the timer maximum",
      withConfig({ waitDurationInOpenMs: MAX_TIMEOUT_DURATION_MS + 1 }),
      `waitDurationInOpenMs to be ${WAIT}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    ["zero maxWaitInHalfOpenMs", withConfig({ maxWaitInHalfOpenMs: 0 }), `maxWaitInHalfOpenMs to be ${WAIT}, got 0`],
    [
      // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
      "infinite maxWaitInHalfOpenMs",
      withConfig({ maxWaitInHalfOpenMs: Number.POSITIVE_INFINITY }),
      `maxWaitInHalfOpenMs to be ${WAIT}, got Infinity`,
    ],
    [
      // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
      "maxWaitInHalfOpenMs above the timer maximum",
      withConfig({ maxWaitInHalfOpenMs: MAX_TIMEOUT_DURATION_MS + 1 }),
      `maxWaitInHalfOpenMs to be ${WAIT}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
  ])("rejects %s", (_label, config, detail) => {
    let thrown: unknown;
    try {
      validateCircuitBreakerConfig("payments", config);
    } catch (error) {
      thrown = error;
    }
    expect(isResilienceConfigError(thrown)).toBe(true);
    expect((thrown as Error).message).toBe(`Circuit breaker "payments" expects ${detail}`);
  });

  test.each<[string, CircuitBreakerConfig]>([
    ["a plain count configuration", VALID],
    ["a failureRateThreshold just above 0", withConfig({ failureRateThreshold: 0.001 })],
    ["a failureRateThreshold of 100", withConfig({ failureRateThreshold: 100 })],
    ["minimumCalls and permittedCallsInHalfOpen of 1", withConfig({ minimumCalls: 1, permittedCallsInHalfOpen: 1 })],
    ["a count window of 1", withWindow({ type: "count", size: 1 }, { minimumCalls: 1 })],
    ["minimumCalls equal to the count window size", withWindow({ type: "count", size: 5 })],
    ["a time window of 1ms", withWindow({ type: "time", size: 1 })],
    ["a time window at the timer maximum", withWindow({ type: "time", size: MAX_TIMEOUT_DURATION_MS })],
    ["minimumCalls above a time window's size", withWindow({ type: "time", size: 10 }, { minimumCalls: 50 })],
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    ["waitDurationInOpenMs at the timer maximum", withConfig({ waitDurationInOpenMs: MAX_TIMEOUT_DURATION_MS })],
    ["a maxWaitInHalfOpenMs of 1ms", withConfig({ maxWaitInHalfOpenMs: 1 })],
    ["a maxWaitInHalfOpenMs at the timer maximum", withConfig({ maxWaitInHalfOpenMs: MAX_TIMEOUT_DURATION_MS })],
    ["a custom isFailure", withConfig({ isFailure: () => true })],
  ])("accepts %s", (_label, config) => {
    expect(() => validateCircuitBreakerConfig("payments", config)).not.toThrow();
  });
});
