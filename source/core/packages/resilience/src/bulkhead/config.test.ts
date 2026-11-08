import { describe, expect, test } from "vitest";
import { isResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";
import { type BulkheadConfig, validateBulkheadConfig } from "./config";

const VALID: BulkheadConfig = { maxConcurrent: 2, maxQueue: 3, maxWaitMs: 500 };

function withConfig(overrides: Partial<BulkheadConfig>): BulkheadConfig {
  return { ...VALID, ...overrides };
}

const WAIT = `finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;
const AT_LEAST_ONE = "an integer of at least 1";
const AT_LEAST_ZERO = "an integer of at least 0";
const INCONSISTENT = "unset while maxQueue is 0";

describe("validateBulkheadConfig", () => {
  test("rejects an empty name", () => {
    expect(() => validateBulkheadConfig("", VALID)).toThrow("A bulkhead needs a non-empty name");
  });

  test.each<[string, BulkheadConfig, string]>([
    ["zero maxConcurrent", withConfig({ maxConcurrent: 0 }), `maxConcurrent to be ${AT_LEAST_ONE}, got 0`],
    ["fractional maxConcurrent", withConfig({ maxConcurrent: 1.5 }), `maxConcurrent to be ${AT_LEAST_ONE}, got 1.5`],
    ["NaN maxConcurrent", withConfig({ maxConcurrent: Number.NaN }), `maxConcurrent to be ${AT_LEAST_ONE}, got NaN`],
    ["negative maxQueue", withConfig({ maxQueue: -1 }), `maxQueue to be ${AT_LEAST_ZERO}, got -1`],
    ["fractional maxQueue", withConfig({ maxQueue: 0.5 }), `maxQueue to be ${AT_LEAST_ZERO}, got 0.5`],
    ["infinite maxQueue", withConfig({ maxQueue: Number.POSITIVE_INFINITY }), `maxQueue to be ${AT_LEAST_ZERO}, got Infinity`],
    ["zero maxWaitMs", withConfig({ maxWaitMs: 0 }), `maxWaitMs to be ${WAIT}, got 0`],
    ["negative maxWaitMs", withConfig({ maxWaitMs: -1 }), `maxWaitMs to be ${WAIT}, got -1`],
    ["NaN maxWaitMs", withConfig({ maxWaitMs: Number.NaN }), `maxWaitMs to be ${WAIT}, got NaN`],
    [
      "maxWaitMs above the timer maximum",
      withConfig({ maxWaitMs: MAX_TIMEOUT_DURATION_MS + 1 }),
      `maxWaitMs to be ${WAIT}, got ${MAX_TIMEOUT_DURATION_MS + 1}`,
    ],
    ["maxWaitMs with maxQueue 0", withConfig({ maxQueue: 0 }), `maxWaitMs to be ${INCONSISTENT}, got 500`],
    ["maxWaitMs with maxQueue left at its default of 0", { maxConcurrent: 2, maxWaitMs: 500 }, `maxWaitMs to be ${INCONSISTENT}, got 500`],
  ])("rejects %s", (_label, config, detail) => {
    let caught: unknown;
    try {
      validateBulkheadConfig("db", config);
    } catch (error) {
      caught = error;
    }
    expect(isResilienceConfigError(caught)).toBe(true);
    expect((caught as Error).message).toBe(`Bulkhead "db" expects ${detail}`);
  });

  test.each<[string, BulkheadConfig]>([
    ["the documented config", VALID],
    ["maxConcurrent alone", { maxConcurrent: 1 }],
    ["maxQueue 0 without maxWaitMs", { maxConcurrent: 1, maxQueue: 0 }],
    ["a queue without maxWaitMs", { maxConcurrent: 1, maxQueue: 5 }],
    ["maxWaitMs at the timer maximum", withConfig({ maxWaitMs: MAX_TIMEOUT_DURATION_MS })],
    ["a fractional maxWaitMs", withConfig({ maxWaitMs: 0.5 })],
  ])("accepts %s", (_label, config) => {
    expect(() => validateBulkheadConfig("db", config)).not.toThrow();
  });
});
