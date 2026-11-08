import { describe, expect, it } from "vitest";
import { DURATION_CONSTRAINT, isDuration, isIntegerAtLeastOne, reject } from "./config-validation";
import { isResilienceConfigError } from "./errors";
import { MAX_TIMEOUT_DURATION_MS } from "./timeout";

describe("reject", () => {
  it("throws a config error naming the label, policy, key, constraint and value", () => {
    let thrown: unknown;
    try {
      reject("Rate limiter", "api", "limit", "an integer of at least 1", 0);
    } catch (error) {
      thrown = error;
    }
    expect(isResilienceConfigError(thrown)).toBe(true);
    expect((thrown as Error).message).toBe('Rate limiter "api" expects limit to be an integer of at least 1, got 0');
  });

  it("uses the label it is given", () => {
    expect(() => reject("Bulkhead", "db", "maxConcurrent", "a number", "x")).toThrow(
      'Bulkhead "db" expects maxConcurrent to be a number, got x',
    );
  });
});

// biome-ignore lint/security/noSecrets: a function name, flagged only for its length and casing
describe("isIntegerAtLeastOne", () => {
  it.each([1, 2, 100])("accepts %s", (value) => {
    expect(isIntegerAtLeastOne(value)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (value) => {
    expect(isIntegerAtLeastOne(value)).toBe(false);
  });
});

describe("isDuration", () => {
  it.each([1, 0.5, MAX_TIMEOUT_DURATION_MS])("accepts %s", (value) => {
    expect(isDuration(value)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMEOUT_DURATION_MS + 1])("rejects %s", (value) => {
    expect(isDuration(value)).toBe(false);
  });
});

describe("DURATION_CONSTRAINT", () => {
  it("states the duration bounds", () => {
    expect(DURATION_CONSTRAINT).toBe(`finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`);
  });
});
