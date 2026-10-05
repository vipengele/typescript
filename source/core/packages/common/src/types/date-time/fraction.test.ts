import { describe, expect, test } from "vitest";
import { formatFraction, parseFraction } from "./fraction";

describe("formatFraction", () => {
  test("writes nothing for a zero fraction", () => {
    expect(formatFraction(0)).toBe("");
  });

  test.for([
    [100_000_000, ".100"],
    [123_000_000, ".123"],
    [1_000_000, ".001"],
    [123_400_000, ".123400"],
    [123_456_000, ".123456"],
    [1_000, ".000001"],
    [123_456_789, ".123456789"],
    [1, ".000000001"],
    [999_999_999, ".999999999"],
  ] as const)("writes %i ns as %s", ([nanoOfSecond, expected]) => {
    expect(formatFraction(nanoOfSecond)).toBe(expected);
  });
});

describe("parseFraction", () => {
  test.for([
    ["1", 100_000_000],
    ["12", 120_000_000],
    ["123", 123_000_000],
    ["1234", 123_400_000],
    ["123456", 123_456_000],
    ["123456789", 123_456_789],
    ["05", 50_000_000],
    ["000000001", 1],
    ["000", 0],
  ] as const)("reads %s as %i ns", ([digits, expected]) => {
    expect(parseFraction(digits)).toBe(expected);
  });

  test.for(["", "1234567890", "1a", " 1", "1 ", "-1", "+1", "1.5", "１"])("rejects %j", (digits) => {
    expect(parseFraction(digits)).toBeUndefined();
  });

  test.for([1, 123_000_000, 123_456_000, 123_456_789, 999_999_999])("reads back what formatFraction writes for %i ns", (nanoOfSecond) => {
    expect(parseFraction(formatFraction(nanoOfSecond).slice(1))).toBe(nanoOfSecond);
  });
});
