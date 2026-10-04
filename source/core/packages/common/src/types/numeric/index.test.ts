import { describe, expect, test } from "vitest";
import { Locale } from "../../locale";
import { format } from "./format";
import { isNumericParseError, Numeric, NumericParseError } from "./index";
import { parse, tryParse } from "./parse";

const EN_US = new Locale("en-US");

describe("Numeric.format", () => {
  test("delegates to format", () => {
    expect(Numeric.format(1234.5, EN_US)).toBe(format(1234.5, EN_US));
  });
});

describe("Numeric.parse", () => {
  test("delegates to parse", () => {
    expect(Numeric.parse("1,234.5", EN_US)).toBe(parse("1,234.5", EN_US));
  });

  test("raises NumericParseError on an unparseable string, same as parse", () => {
    expect(() => Numeric.parse("nope", EN_US)).toThrow(NumericParseError);
  });
});

describe("Numeric.tryParse", () => {
  test("delegates to tryParse on success", () => {
    expect(Numeric.tryParse("1,234.5", EN_US)).toEqual(tryParse("1,234.5", EN_US));
  });

  test("delegates to tryParse on failure", () => {
    expect(Numeric.tryParse("nope", EN_US)).toEqual(tryParse("nope", EN_US));
  });
});

describe("re-exported error guard", () => {
  test("recognises what Numeric.parse throws", () => {
    try {
      Numeric.parse("nope", EN_US);
      expect.unreachable("Numeric.parse accepted an unparseable string");
    } catch (error) {
      expect(error).toBeInstanceOf(NumericParseError);
      expect(isNumericParseError(error)).toBe(true);
    }
  });
});
