import { describe, expect, test } from "vitest";
import { millisToNanoString } from "./time";

describe("millisToNanoString", () => {
  test("converts a fractional epoch millisecond without binary drift", () => {
    expect(millisToNanoString(1700000000123.456)).toBe("1700000000123456000");
    expect(millisToNanoString(1700000000123.1)).toBe("1700000000123100000");
  });

  test("converts whole milliseconds", () => {
    expect(millisToNanoString(1700000000123)).toBe("1700000000123000000");
    expect(millisToNanoString(1)).toBe("1000000");
  });

  test("drops digits past the nanosecond", () => {
    expect(millisToNanoString(1.0000019)).toBe("1000001");
    expect(millisToNanoString(0.000001)).toBe("1");
    expect(millisToNanoString(0.5)).toBe("500000");
  });

  test("gives 0 below one nanosecond, for zero, negatives and non-finite numbers", () => {
    expect(millisToNanoString(1e-7)).toBe("0");
    expect(millisToNanoString(0.0000001)).toBe("0");
    expect(millisToNanoString(0)).toBe("0");
    expect(millisToNanoString(-5)).toBe("0");
    expect(millisToNanoString(Number.NaN)).toBe("0");
    expect(millisToNanoString(Number.POSITIVE_INFINITY)).toBe("0");
  });

  test("converts a number large enough for exponent notation exactly", () => {
    expect(millisToNanoString(1e21)).toBe("1000000000000000000000000000");
  });
});
