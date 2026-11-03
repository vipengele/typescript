import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "./retry-after";

const NOW = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");

describe("parseRetryAfter", () => {
  it.each([
    ["0", 0],
    ["120", 120_000],
    ["  7  ", 7000],
    ["007", 7000],
  ])("reads delta-seconds %j as %d ms", (header, expected) => {
    expect(parseRetryAfter(header, NOW)).toBe(expected);
  });

  it.each([
    ["Wed, 21 Oct 2015 07:28:30 GMT", 30_000],
    ["Wed, 21 Oct 2015 07:28:00 GMT", 0],
    ["  Wed, 21 Oct 2015 07:30:00 GMT ", 120_000],
  ])("reads HTTP-date %j as %d ms from now", (header, expected) => {
    expect(parseRetryAfter(header, NOW)).toBe(expected);
  });

  it("gives 0 for a date in the past", () => {
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:27:00 GMT", NOW)).toBe(0);
  });

  it.each([[null], [""], ["   "], ["soon"], ["-5"], ["1.5"], ["+5"], ["2026-10-30"], ["1e3"], ["5 seconds"], ["9".repeat(400)]])(
    "gives undefined for %j",
    (header) => {
      expect(parseRetryAfter(header, NOW)).toBeUndefined();
    },
  );
});
