import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
import { format } from "./format";

/** No-break space, `sv-SE`'s group separator. */
const NBSP = " ";
/** Narrow no-break space, `fr-FR`'s group separator. */
const NNBSP = " ";
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

describe("locale-specific output", () => {
  test.for([
    ["sv-SE", 1234567.89, `1${NBSP}234${NBSP}567,89`],
    ["sv-SE", -12345678.9, `${MINUS}12${NBSP}345${NBSP}678,9`],
    ["fr-FR", 1234567.89, `1${NNBSP}234${NNBSP}567,89`],
    ["fr-FR", -12345678.9, `-12${NNBSP}345${NNBSP}678,9`],
    ["de-CH", 1234567.89, `1${DE_CH_GROUP}234${DE_CH_GROUP}567.89`],
    ["de-CH", -12345678.9, `-12${DE_CH_GROUP}345${DE_CH_GROUP}678.9`],
    ["ar-EG", 1234567.89, "1,234,567.89"],
    ["ar-EG", -12345678.9, `${LTR}-12,345,678.9`],
    ["fa-IR", 1234567.89, "1,234,567.89"],
    ["fa-IR", -12345678.9, `${LTR}${MINUS}12,345,678.9`],
    ["en-IN", 1234567.89, "12,34,567.89"],
    ["en-IN", -12345678.9, "-1,23,45,678.9"],
  ] as const)("%s formats %d", ([tag, value, expected]) => {
    expect(format(value, new Locale(tag))).toBe(expected);
  });
});

describe("numbering system", () => {
  test.for(["ar-EG", "fa-IR", "en-IN"])("%s emits ASCII digits and no others", (tag) => {
    expect(format(1234567.89, new Locale(tag))).toMatch(/[0-9]/);
    expect(format(1234567.89, new Locale(tag))).not.toMatch(/(?![0-9])\p{Nd}/u);
  });

  test("ar-EG would use Arabic-Indic digits without the forced numbering system", () => {
    expect(new Intl.NumberFormat("ar-EG").format(1234)).not.toBe(format(1234, new Locale("ar-EG")));
  });
});

describe("maximumFractionDigits", () => {
  test("defaults to 20 rather than the platform's silently rounding 3", () => {
    expect(format(0.123456789, EN_US)).toBe("0.123456789");
  });

  test("an explicit value rounds to it", () => {
    expect(format(1.239, EN_US, { maximumFractionDigits: 2 })).toBe("1.24");
  });

  test("zero drops the fractional part entirely", () => {
    expect(format(1234.6, EN_US, { maximumFractionDigits: 0 })).toBe("1,235");
  });
});

describe("non-finite values", () => {
  test.for([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("%d raises RangeError", (value) => {
    expect(() => format(value, EN_US)).toThrow(RangeError);
  });
});

test("an omitted locale formats with Locale.default()", () => {
  const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

  try {
    expect(format(1234567.89)).toBe("1.234.567,89");
  } finally {
    spy.mockRestore();
  }
});

test("an omitted locale is read on every call rather than fixed at the first", () => {
  const spy = vi.spyOn(Locale, "default");

  try {
    spy.mockReturnValue(new Locale("de-DE"));
    expect(format(1234.5)).toBe("1.234,5");

    spy.mockReturnValue(EN_US);
    expect(format(1234.5)).toBe("1,234.5");
  } finally {
    spy.mockRestore();
  }
});

test("two Locale instances for the same tag format alike", () => {
  expect(format(1234.5, new Locale("sv-SE"))).toBe(format(1234.5, new Locale("sv-se")));
});
