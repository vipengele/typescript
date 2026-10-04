import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
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
/**
 * de-CH's group character, read from `Intl` rather than hardcoded — it has moved between ICU
 * versions (U+0027 on one, U+2019 on another).
 */
const DE_CH_GROUP = new Intl.NumberFormat("de-CH", { numberingSystem: "latn" })
  .formatToParts(1234)
  .find((part) => part.type === "group")?.value;

const EN_US = new Locale("en-US");

const LOCALES = ["sv-SE", "fr-FR", "de-CH", "ar-EG", "fa-IR", "en-IN", "de-DE", "en-US"] as const;

const ROUND_TRIP_VALUES = [0, 1, -1, 0.5, 1234567.89, -12345678.9, 0.123456789, 12345678901234] as const;

describe("round-trip through format", () => {
  for (const tag of LOCALES) {
    const locale = new Locale(tag);
    test.for(ROUND_TRIP_VALUES)(`${tag} reads back %d`, (value) => {
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
    ["de-CH", `1${DE_CH_GROUP}234${DE_CH_GROUP}567.89`, 1234567.89],
    ["de-CH", `-12${DE_CH_GROUP}345${DE_CH_GROUP}678.9`, -12345678.9],
    ["ar-EG", "1,234,567.89", 1234567.89],
    ["ar-EG", `${LTR}-12,345,678.9`, -12345678.9],
    ["fa-IR", "1,234,567.89", 1234567.89],
    ["fa-IR", `${LTR}${MINUS}12,345,678.9`, -12345678.9],
    ["en-IN", "12,34,567.89", 1234567.89],
    ["en-IN", "-1,23,45,678.9", -12345678.9],
    ["de-DE", "12.345.678,9", 12345678.9],
  ] as const)("%s parses %s", ([tag, text, expected]) => {
    expect(parse(text, new Locale(tag))).toBe(expected);
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
  ] as const)("%s parses %s typed on an ASCII keyboard", ([tag, text, expected]) => {
    expect(parse(text, new Locale(tag))).toBe(expected);
  });

  test.for(LOCALES)("%s reads its own negative output retyped in ASCII", (tag) => {
    const locale = new Locale(tag);
    const typed = format(-12345678.9, locale).replace(/‎/g, "").replace(/−/g, "-").replace(/[  ]/g, " ");

    expect(parse(typed, locale)).toBe(-12345678.9);
  });
});

describe("grouping", () => {
  test("en-IN's irregular groups are stripped without validating their size", () => {
    expect(parse("1,23,45,678", new Locale("en-IN"))).toBe(12345678);
  });

  test("groups of any size are stripped, wherever they sit", () => {
    expect(parse("1,2,3,4", EN_US)).toBe(1234);
  });

  test("a group separator is optional", () => {
    expect(parse("12345678.9", EN_US)).toBe(12345678.9);
  });
});

describe("invisible marks", () => {
  test.for(["ar-EG", "fa-IR"] as const)("%s parses a positive value, which carries no mark", (tag) => {
    const locale = new Locale(tag);
    expect(parse(format(1234.5, locale), locale)).toBe(1234.5);
  });

  test.for(["ar-EG", "fa-IR"] as const)("%s parses a negative value, which carries a leading U+200E", (tag) => {
    const locale = new Locale(tag);
    const formatted = format(-1234.5, locale);

    expect(formatted).toContain(LTR);
    expect(parse(formatted, locale)).toBe(-1234.5);
  });

  test("a mark is stripped wherever it sits, for any locale", () => {
    expect(parse(`﻿1​234‏.5`, EN_US)).toBe(1234.5);
  });
});

describe("parse failures", () => {
  test.for(["", "   ", "‎", "1.2.3", "1,2.3.4", "abc", "12abc", "0x10", "1e3", "-", "1 234", "+1"] as const)(
    "%o raises NumericParseError",
    (text) => {
      expect(() => parse(text, EN_US)).toThrow(NumericParseError);
    },
  );

  test.for(["", "   ", "1.2.3", "abc"] as const)("%o is an unsuccessful tryParse", (text) => {
    expect(tryParse(text, EN_US)).toEqual({ success: false });
  });

  test("a number too large for a double is a failure, not Infinity", () => {
    const tooLarge = `1${"0".repeat(400)}`;

    expect(tryParse(tooLarge, EN_US)).toEqual({ success: false });
  });

  test("the raised error is recognised by its guard", () => {
    try {
      parse("", EN_US);
      expect.unreachable("parse accepted an empty string");
    } catch (error) {
      expect(isNumericParseError(error)).toBe(true);
    }
  });

  test("the message quotes the string that failed", () => {
    expect(() => parse("1.2.3", EN_US)).toThrow('"1.2.3"');
  });

  test("a separator-only string is a failure", () => {
    expect(tryParse(".", EN_US)).toEqual({ success: false });
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
    expect(parse(text, EN_US)).toBe(expected);
  });
});

describe("tryParse", () => {
  test("a parseable string yields the value", () => {
    expect(tryParse("1,234.5", EN_US)).toEqual({ success: true, value: 1234.5 });
  });

  test("an unsuccessful result carries no value", () => {
    expect(tryParse("nope", EN_US).value).toBeUndefined();
  });
});

describe("the default locale", () => {
  const DE_DE = new Locale("de-DE");

  test("parse reads what the default locale formats", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(DE_DE);

    try {
      expect(parse(format(-12345678.9))).toBe(-12345678.9);
    } finally {
      spy.mockRestore();
    }
  });

  test("an omitted locale parses as Locale.default() does", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(DE_DE);

    try {
      expect(parse("1.234.567,89")).toBe(1234567.89);
    } finally {
      spy.mockRestore();
    }
  });

  test("tryParse follows the same default", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(DE_DE);

    try {
      expect(tryParse("1.234,5")).toEqual({ success: true, value: 1234.5 });
    } finally {
      spy.mockRestore();
    }
  });
});
