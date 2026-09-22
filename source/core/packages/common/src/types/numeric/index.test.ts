import { describe, expect, test } from "vitest";
import { format } from "./format";
import { isNumericParseError, Numeric, NumericParseError } from "./index";
import { parse, tryParse } from "./parse";

describe("Numeric.format", () => {
  test("delegates to format", () => {
    expect(Numeric.format(1234.5, "en-US")).toBe(format(1234.5, "en-US"));
  });
});

describe("Numeric.parse", () => {
  test("delegates to parse", () => {
    expect(Numeric.parse("1,234.5", "en-US")).toBe(parse("1,234.5", "en-US"));
  });

  test("raises NumericParseError on an unparseable string, same as parse", () => {
    expect(() => Numeric.parse("nope", "en-US")).toThrow(NumericParseError);
  });
});

describe("Numeric.tryParse", () => {
  test("delegates to tryParse on success", () => {
    expect(Numeric.tryParse("1,234.5", "en-US")).toEqual(tryParse("1,234.5", "en-US"));
  });

  test("delegates to tryParse on failure", () => {
    expect(Numeric.tryParse("nope", "en-US")).toEqual(tryParse("nope", "en-US"));
  });
});

describe("re-exported error guard", () => {
  test("recognises what Numeric.parse throws", () => {
    try {
      Numeric.parse("nope", "en-US");
      expect.unreachable("Numeric.parse accepted an unparseable string");
    } catch (error) {
      expect(error).toBeInstanceOf(NumericParseError);
      expect(isNumericParseError(error)).toBe(true);
    }
  });
});
