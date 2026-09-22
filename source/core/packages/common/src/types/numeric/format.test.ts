import { describe, expect, test } from "vitest";
import { format } from "./format";

/** No-break space, `sv-SE`'s group separator. */
const NBSP = " ";
/** Narrow no-break space, `fr-FR`'s group separator. */
const NNBSP = " ";
/** Minus sign, distinct from hyphen-minus; `sv-SE` and `fa-IR` negate with it. */
const MINUS = "−";
/** Left-to-right mark, which `ar-EG` and `fa-IR` prefix a negative number with. */
const LTR = "‎";

describe("locale-specific output", () => {
  test.for([
    ["sv-SE", 1234567.89, `1${NBSP}234${NBSP}567,89`],
    ["sv-SE", -12345678.9, `${MINUS}12${NBSP}345${NBSP}678,9`],
    ["fr-FR", 1234567.89, `1${NNBSP}234${NNBSP}567,89`],
    ["fr-FR", -12345678.9, `-12${NNBSP}345${NNBSP}678,9`],
    ["de-CH", 1234567.89, "1'234'567.89"],
    ["de-CH", -12345678.9, "-12'345'678.9"],
    ["ar-EG", 1234567.89, "1,234,567.89"],
    ["ar-EG", -12345678.9, `${LTR}-12,345,678.9`],
    ["fa-IR", 1234567.89, "1,234,567.89"],
    ["fa-IR", -12345678.9, `${LTR}${MINUS}12,345,678.9`],
    ["en-IN", 1234567.89, "12,34,567.89"],
    ["en-IN", -12345678.9, "-1,23,45,678.9"],
  ] as const)("%s formats %d", ([locale, value, expected]) => {
    expect(format(value, locale)).toBe(expected);
  });
});

describe("numbering system", () => {
  test.for(["ar-EG", "fa-IR", "en-IN"])("%s emits ASCII digits and no others", (locale) => {
    expect(format(1234567.89, locale)).toMatch(/[0-9]/);
    expect(format(1234567.89, locale)).not.toMatch(/(?![0-9])\p{Nd}/u);
  });

  test("ar-EG would use Arabic-Indic digits without the forced numbering system", () => {
    expect(new Intl.NumberFormat("ar-EG").format(1234)).not.toBe(format(1234, "ar-EG"));
  });
});

describe("maximumFractionDigits", () => {
  test("defaults to 20 rather than the platform's silently rounding 3", () => {
    expect(format(0.123456789, "en-US")).toBe("0.123456789");
  });

  test("an explicit value rounds to it", () => {
    expect(format(1.239, "en-US", { maximumFractionDigits: 2 })).toBe("1.24");
  });

  test("zero drops the fractional part entirely", () => {
    expect(format(1234.6, "en-US", { maximumFractionDigits: 0 })).toBe("1,235");
  });
});

describe("non-finite values", () => {
  test.for([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("%d raises RangeError", (value) => {
    expect(() => format(value, "en-US")).toThrow(RangeError);
  });
});

test("an omitted locale formats with the runtime's default locale", () => {
  const defaultLocale = new Intl.NumberFormat().resolvedOptions().locale;

  expect(format(1234567.89)).toBe(format(1234567.89, defaultLocale));
});

test("an invalid language tag raises RangeError", () => {
  expect(() => format(1, "not a locale")).toThrow(RangeError);
});
