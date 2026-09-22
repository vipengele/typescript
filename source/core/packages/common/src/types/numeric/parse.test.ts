import { describe, expect, test } from "vitest";
import { format } from "./format";
import { isNumericParseError, NumericParseError } from "./numeric-parse-error";
import { parse, tryParse } from "./parse";

/** No-break space, `sv-SE`'s group separator. */
const NBSP = " ";
/** Narrow no-break space, `fr-FR`'s group separator. */
const NNBSP = " ";
/** Minus sign, distinct from hyphen-minus; `sv-SE` and `fa-IR` negate with it. */
const MINUS = "−";
/** Left-to-right mark, which `ar-EG` and `fa-IR` prefix a negative number with. */
const LTR = "‎";

const LOCALES = ["sv-SE", "fr-FR", "de-CH", "ar-EG", "fa-IR", "en-IN", "de-DE", "en-US"] as const;

const ROUND_TRIP_VALUES = [0, 1, -1, 0.5, 1234567.89, -12345678.9, 0.123456789, 12345678901234] as const;

describe("round-trip through format", () => {
  for (const locale of LOCALES) {
    test.for(ROUND_TRIP_VALUES)(`${locale} reads back %d`, (value) => {
      expect(parse(format(value, locale), locale)).toBe(value);
    });
  }
});

describe("locale-specific input", () => {
  test.for([
    ["sv-SE", `1${NBSP}234${NBSP}567,89`, 1234567.89],
    ["sv-SE", `${MINUS}12${NBSP}345${NBSP}678,9`, -12345678.9],
    ["fr-FR", `1${NNBSP}234${NNBSP}567,89`, 1234567.89],
    ["fr-FR", `-12${NNBSP}345${NNBSP}678,9`, -12345678.9],
    ["de-CH", "1'234'567.89", 1234567.89],
    ["de-CH", "-12'345'678.9", -12345678.9],
    ["ar-EG", "1,234,567.89", 1234567.89],
    ["ar-EG", `${LTR}-12,345,678.9`, -12345678.9],
    ["fa-IR", "1,234,567.89", 1234567.89],
    ["fa-IR", `${LTR}${MINUS}12,345,678.9`, -12345678.9],
    ["en-IN", "12,34,567.89", 1234567.89],
    ["en-IN", "-1,23,45,678.9", -12345678.9],
    ["de-DE", "12.345.678,9", 12345678.9],
  ] as const)("%s parses %s", ([locale, text, expected]) => {
    expect(parse(text, locale)).toBe(expected);
  });
});

describe("ASCII-typed input", () => {
  test.for([
    ["sv-SE", "1 234 567,89", 1234567.89],
    ["sv-SE", "-12 345 678,9", -12345678.9],
    ["fr-FR", "1 234 567,89", 1234567.89],
    ["fr-FR", "-12 345 678,9", -12345678.9],
    ["de-CH", "1'234'567.89", 1234567.89],
    ["ar-EG", "-12,345,678.9", -12345678.9],
    ["fa-IR", "-12,345,678.9", -12345678.9],
    ["en-IN", "-1,23,45,678.9", -12345678.9],
  ] as const)("%s parses %s typed on an ASCII keyboard", ([locale, text, expected]) => {
    expect(parse(text, locale)).toBe(expected);
  });

  test.for(LOCALES)("%s reads its own negative output retyped in ASCII", (locale) => {
    const typed = format(-12345678.9, locale).replace(/‎/g, "").replace(/−/g, "-").replace(/[  ]/g, " ");

    expect(parse(typed, locale)).toBe(-12345678.9);
  });
});

describe("grouping", () => {
  test("en-IN's irregular groups are stripped without validating their size", () => {
    expect(parse("1,23,45,678", "en-IN")).toBe(12345678);
  });

  test("groups of any size are stripped, wherever they sit", () => {
    expect(parse("1,2,3,4", "en-US")).toBe(1234);
  });

  test("a group separator is optional", () => {
    expect(parse("12345678.9", "en-US")).toBe(12345678.9);
  });
});

describe("invisible marks", () => {
  test.for(["ar-EG", "fa-IR"] as const)("%s parses a positive value, which carries no mark", (locale) => {
    expect(parse(format(1234.5, locale), locale)).toBe(1234.5);
  });

  test.for(["ar-EG", "fa-IR"] as const)("%s parses a negative value, which carries a leading U+200E", (locale) => {
    const formatted = format(-1234.5, locale);

    expect(formatted).toContain(LTR);
    expect(parse(formatted, locale)).toBe(-1234.5);
  });

  test("a mark is stripped wherever it sits, for any locale", () => {
    expect(parse(`﻿1​234‏.5`, "en-US")).toBe(1234.5);
  });
});

describe("parse failures", () => {
  test.for(["", "   ", "‎", "1.2.3", "1,2.3.4", "abc", "12abc", "0x10", "1e3", "-", "1 234", "+1"] as const)(
    "%o raises NumericParseError",
    (text) => {
      expect(() => parse(text, "en-US")).toThrow(NumericParseError);
    },
  );

  test.for(["", "   ", "1.2.3", "abc"] as const)("%o is an unsuccessful tryParse", (text) => {
    expect(tryParse(text, "en-US")).toEqual({ success: false });
  });

  test("a number too large for a double is a failure, not Infinity", () => {
    const tooLarge = `1${"0".repeat(400)}`;

    expect(tryParse(tooLarge, "en-US")).toEqual({ success: false });
  });

  test("the raised error is recognised by its guard", () => {
    try {
      parse("", "en-US");
      expect.unreachable("parse accepted an empty string");
    } catch (error) {
      expect(isNumericParseError(error)).toBe(true);
    }
  });

  test("the message quotes the string that failed", () => {
    expect(() => parse("1.2.3", "en-US")).toThrow('"1.2.3"');
  });

  test("a separator-only string is a failure", () => {
    expect(tryParse(".", "en-US")).toEqual({ success: false });
  });
});

describe("lenient but unambiguous forms", () => {
  test.for([
    [".5", 0.5],
    ["5.", 5],
    ["  12.5  ", 12.5],
    ["-.5", -0.5],
    ["007", 7],
  ] as const)("en-US parses %s", ([text, expected]) => {
    expect(parse(text, "en-US")).toBe(expected);
  });
});

describe("tryParse", () => {
  test("a parseable string yields the value", () => {
    expect(tryParse("1,234.5", "en-US")).toEqual({ success: true, value: 1234.5 });
  });

  test("an unsuccessful result carries no value", () => {
    expect(tryParse("nope", "en-US").value).toBeUndefined();
  });
});

describe("the default locale", () => {
  const defaultLocale = new Intl.NumberFormat().resolvedOptions().locale;

  test("parse reads what the default locale formats", () => {
    expect(parse(format(-12345678.9))).toBe(-12345678.9);
  });

  test("an omitted locale parses as the resolved default does", () => {
    const text = format(1234567.89, defaultLocale);

    expect(parse(text)).toBe(parse(text, defaultLocale));
  });

  test("tryParse follows the same default", () => {
    expect(tryParse(format(1234.5))).toEqual(tryParse(format(1234.5), defaultLocale));
  });
});

describe("an invalid language tag", () => {
  test("propagates a RangeError out of parse, unwrapped", () => {
    expect(() => parse("1", "not a locale")).toThrow(RangeError);
    expect(() => parse("1", "not a locale")).not.toThrow(NumericParseError);
  });

  test("propagates a RangeError out of tryParse rather than becoming an unsuccessful result", () => {
    expect(() => tryParse("1", "not a locale")).toThrow(RangeError);
  });

  test("propagates even when the string is unparseable anyway", () => {
    expect(() => tryParse("nope", "not a locale")).toThrow(RangeError);
  });
});
