import { describe, expect, test } from "vitest";
import { isLevel, SEVERITY_NUMBERS } from "./severity";

describe("SEVERITY_NUMBERS", () => {
  test("maps each level to its OpenTelemetry severity number", () => {
    expect(SEVERITY_NUMBERS).toEqual({ trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 });
  });

  test("is frozen", () => {
    expect(Object.isFrozen(SEVERITY_NUMBERS)).toBe(true);
  });
});

describe("isLevel", () => {
  test.each(["trace", "debug", "info", "warn", "error", "fatal"])("accepts %s", (level) => {
    expect(isLevel(level)).toBe(true);
  });

  test.each(["constructor", "toString", "__proto__", "off", "INFO", ""])("rejects the string %j", (value) => {
    expect(isLevel(value)).toBe(false);
  });

  test.each([undefined, null, 1, true, {}, ["info"], Symbol("info")])("rejects the non-string %s", (value) => {
    expect(isLevel(value)).toBe(false);
  });
});
