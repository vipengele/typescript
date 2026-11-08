import { describe, expect, test } from "vitest";
import { isResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";
import { type RateLimiterConfig, validateRateLimiterConfig } from "./config";

const VALID: RateLimiterConfig = { limitForPeriod: 5, refreshPeriodMs: 1_000, maxWaitMs: 500 };

function withConfig(overrides: Partial<RateLimiterConfig>): RateLimiterConfig {
  return { ...VALID, ...overrides };
}

const PERIOD = `finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;
const WAIT = `finite, at least 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;
const INTEGER = "an integer of at least 1";
const BURST = "an integer of at least limitForPeriod 5";

describe("validateRateLimiterConfig", () => {
  test("rejects an empty name", () => {
    expect(() => validateRateLimiterConfig("", VALID)).toThrow("A rate limiter needs a non-empty name");
  });

  test.each<[string, RateLimiterConfig, string]>([
    ["zero limitForPeriod", withConfig({ limitForPeriod: 0 }), `limitForPeriod to be ${INTEGER}, got 0`],
    ["fractional limitForPeriod", withConfig({ limitForPeriod: 1.5 }), `limitForPeriod to be ${INTEGER}, got 1.5`],
    ["NaN limitForPeriod", withConfig({ limitForPeriod: Number.NaN }), `limitForPeriod to be ${INTEGER}, got NaN`],
    ["zero refreshPeriodMs", withConfig({ refreshPeriodMs: 0 }), `refreshPeriodMs to be ${PERIOD}, got 0`],
    ["negative refreshPeriodMs", withConfig({ refreshPeriodMs: -1 }), `refreshPeriodMs to be ${PERIOD}, got -1`],
    [
      "infinite refreshPeriodMs",
      withConfig({ refreshPeriodMs: Number.POSITIVE_INFINITY }),
      `refreshPeriodMs to be ${PERIOD}, got Infinity`,
    ],
    [
      "refreshPeriodMs above the timer maximum",
      withConfig({ refreshPeriodMs: MAX_TIMEOUT_DURATION_MS + 1 }),
      `refreshPeriodMs to be ${PERIOD}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
    ["negative maxWaitMs", withConfig({ maxWaitMs: -1 }), `maxWaitMs to be ${WAIT}, got -1`],
    ["NaN maxWaitMs", withConfig({ maxWaitMs: Number.NaN }), `maxWaitMs to be ${WAIT}, got NaN`],
    [
      "maxWaitMs above the timer maximum",
      withConfig({ maxWaitMs: MAX_TIMEOUT_DURATION_MS + 1 }),
      `maxWaitMs to be ${WAIT}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
    ["burst below limitForPeriod", withConfig({ burst: 4 }), `burst to be ${BURST}, got 4`],
    ["fractional burst", withConfig({ burst: 5.5 }), `burst to be ${BURST}, got 5.5`],
    ["NaN burst", withConfig({ burst: Number.NaN }), `burst to be ${BURST}, got NaN`],
  ])("rejects %s", (_label, config, detail) => {
    let caught: unknown;
    try {
      validateRateLimiterConfig("api", config);
    } catch (error) {
      caught = error;
    }
    expect(isResilienceConfigError(caught)).toBe(true);
    expect((caught as Error).message).toBe(`Rate limiter "api" expects ${detail}`);
  });

  test.each<[string, RateLimiterConfig]>([
    ["the documented config", VALID],
    ["maxWaitMs 0", withConfig({ maxWaitMs: 0 })],
    ["maxWaitMs at the timer maximum", withConfig({ maxWaitMs: MAX_TIMEOUT_DURATION_MS })],
    ["refreshPeriodMs at the timer maximum", withConfig({ refreshPeriodMs: MAX_TIMEOUT_DURATION_MS })],
    ["a fractional refreshPeriodMs", withConfig({ refreshPeriodMs: 0.5 })],
    ["burst equal to limitForPeriod", withConfig({ burst: 5 })],
    ["burst above limitForPeriod", withConfig({ burst: 20 })],
  ])("accepts %s", (_label, config) => {
    expect(() => validateRateLimiterConfig("api", config)).not.toThrow();
  });
});
