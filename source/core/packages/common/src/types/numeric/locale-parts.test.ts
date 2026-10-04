import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
import { resolveLocaleParts } from "./locale-parts";

describe("separator characters per locale", () => {
  test("sv-SE negates with U+2212 and groups with U+00A0", () => {
    expect(resolveLocaleParts(new Locale("sv-SE"))).toEqual({ group: " ", decimal: ",", minus: "−" });
  });

  test("fr-FR groups with U+202F", () => {
    expect(resolveLocaleParts(new Locale("fr-FR"))).toEqual({ group: " ", decimal: ",", minus: "-" });
  });

  test("de-CH's group character matches what Intl itself reports", () => {
    // de-CH's group character has moved between ICU versions — U+0027 (ASCII
    // apostrophe) on one, U+2019 (right single quotation mark) on another —
    // so the expectation is read from Intl directly rather than hardcoded.
    const expectedGroup = new Intl.NumberFormat("de-CH", { numberingSystem: "latn" })
      .formatToParts(1234)
      .find((part) => part.type === "group")?.value;

    expect(resolveLocaleParts(new Locale("de-CH"))).toEqual({ group: expectedGroup, decimal: ".", minus: "-" });
  });

  test("ar-EG resolves past the leading U+200E literal part", () => {
    expect(resolveLocaleParts(new Locale("ar-EG"))).toEqual({ group: ",", decimal: ".", minus: "-" });
  });

  test("fa-IR resolves past the leading U+200E literal part and negates with U+2212", () => {
    expect(resolveLocaleParts(new Locale("fa-IR"))).toEqual({ group: ",", decimal: ".", minus: "−" });
  });

  test("en-IN uses ASCII separators despite its irregular grouping", () => {
    expect(resolveLocaleParts(new Locale("en-IN"))).toEqual({ group: ",", decimal: ".", minus: "-" });
  });

  test("de-DE swaps the en-US separators", () => {
    expect(resolveLocaleParts(new Locale("de-DE"))).toEqual({ group: ".", decimal: ",", minus: "-" });
  });
});

test("an omitted locale resolves Locale.default()", () => {
  const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

  try {
    expect(resolveLocaleParts()).toEqual({ group: ".", decimal: ",", minus: "-" });
  } finally {
    spy.mockRestore();
  }
});

test("the resolved characters match what the same locale formats with", () => {
  const { group, decimal, minus } = resolveLocaleParts(new Locale("sv-SE"));
  const formatted = new Intl.NumberFormat("sv-SE", { numberingSystem: "latn" }).format(-12345.6);

  expect(formatted).toBe(`${minus}12${group}345${decimal}6`);
});

test("two Locale instances for the same canonical tag share one cached result", () => {
  expect(resolveLocaleParts(new Locale("sv-SE"))).toBe(resolveLocaleParts(new Locale("sv-se")));
});

test("an empty language tag raises RangeError before any locale reaches resolveLocaleParts", () => {
  expect(() => new Locale("")).toThrow(RangeError);
});
