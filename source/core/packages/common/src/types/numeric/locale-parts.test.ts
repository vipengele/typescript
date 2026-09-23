import { describe, expect, test } from "vitest";
import { resolveLocaleParts } from "./locale-parts";

describe("separator characters per locale", () => {
  test("sv-SE negates with U+2212 and groups with U+00A0", () => {
    expect(resolveLocaleParts("sv-SE")).toEqual({ group: " ", decimal: ",", minus: "−" });
  });

  test("fr-FR groups with U+202F", () => {
    expect(resolveLocaleParts("fr-FR")).toEqual({ group: " ", decimal: ",", minus: "-" });
  });

  test("de-CH's group character matches what Intl itself reports", () => {
    // de-CH's group character has moved between ICU versions — U+0027 (ASCII
    // apostrophe) on one, U+2019 (right single quotation mark) on another —
    // so the expectation is read from Intl directly rather than hardcoded.
    const expectedGroup = new Intl.NumberFormat("de-CH", { numberingSystem: "latn" })
      .formatToParts(1234)
      .find((part) => part.type === "group")?.value;

    expect(resolveLocaleParts("de-CH")).toEqual({ group: expectedGroup, decimal: ".", minus: "-" });
  });

  test("ar-EG resolves past the leading U+200E literal part", () => {
    expect(resolveLocaleParts("ar-EG")).toEqual({ group: ",", decimal: ".", minus: "-" });
  });

  test("fa-IR resolves past the leading U+200E literal part and negates with U+2212", () => {
    expect(resolveLocaleParts("fa-IR")).toEqual({ group: ",", decimal: ".", minus: "−" });
  });

  test("en-IN uses ASCII separators despite its irregular grouping", () => {
    expect(resolveLocaleParts("en-IN")).toEqual({ group: ",", decimal: ".", minus: "-" });
  });

  test("de-DE swaps the en-US separators", () => {
    expect(resolveLocaleParts("de-DE")).toEqual({ group: ".", decimal: ",", minus: "-" });
  });
});

test("an omitted locale resolves the runtime's default locale", () => {
  const defaultLocale = new Intl.NumberFormat().resolvedOptions().locale;

  expect(resolveLocaleParts()).toEqual(resolveLocaleParts(defaultLocale));
});

test("the resolved characters match what the same locale formats with", () => {
  const { group, decimal, minus } = resolveLocaleParts("sv-SE");
  const formatted = new Intl.NumberFormat("sv-SE", { numberingSystem: "latn" }).format(-12345.6);

  expect(formatted).toBe(`${minus}12${group}345${decimal}6`);
});

test("an invalid language tag raises RangeError", () => {
  expect(() => resolveLocaleParts("not a locale")).toThrow(RangeError);
});

test("an empty string still raises RangeError after the omitted locale has been cached", () => {
  resolveLocaleParts();

  expect(() => resolveLocaleParts("")).toThrow(RangeError);
});
