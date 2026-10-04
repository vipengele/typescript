import { describe, expect, test } from "vitest";
import { civilFromDays, dayOfWeekFromDays, daysFromCivil, isLeapYear, lengthOfMonth } from "./civil";

describe("isLeapYear", () => {
  test.for([
    [2024, true],
    [2026, false],
    [2000, true],
    [1900, false],
    [2100, false],
    [1600, true],
    [0, true],
    [-4, true],
    [-100, false],
  ] as const)("%i is a leap year: %s", ([year, leap]) => {
    expect(isLeapYear(year)).toBe(leap);
  });
});

describe("lengthOfMonth", () => {
  test("gives every month of a common year", () => {
    expect(Array.from({ length: 12 }, (_, index) => lengthOfMonth(2026, index + 1))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });

  test("gives February 29 days in a leap year", () => {
    expect(lengthOfMonth(2024, 2)).toBe(29);
  });
});

describe("daysFromCivil", () => {
  test.for([
    [1970, 1, 1, 0],
    [1970, 1, 2, 1],
    [1969, 12, 31, -1],
    [2000, 3, 1, 11_017],
    [2026, 10, 1, 20_727],
    [1, 1, 1, -719_162],
    [9999, 12, 31, 2_932_896],
  ] as const)("%i-%i-%i is day %i", ([year, month, day, days]) => {
    expect(daysFromCivil(year, month, day)).toBe(days);
  });

  test("agrees with Date.UTC across four centuries", () => {
    for (let days = -146_097 * 2; days <= 146_097 * 2; days += 37) {
      const { year, month, day } = civilFromDays(days);
      const date = new Date(days * 86_400_000);
      expect([year, month, day]).toEqual([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]);
      expect(daysFromCivil(year, month, day)).toBe(days);
    }
  });
});

describe("civilFromDays", () => {
  test("inverts daysFromCivil around leap days", () => {
    for (const [year, month, day] of [
      [2024, 2, 28],
      [2024, 2, 29],
      [2024, 3, 1],
      [1900, 2, 28],
      [1900, 3, 1],
      [2000, 2, 29],
      [1, 1, 1],
      [9999, 12, 31],
    ] as const) {
      expect(civilFromDays(daysFromCivil(year, month, day))).toEqual({ year, month, day });
    }
  });
});

describe("the ISO day of the week of a day count", () => {
  test("reads 1970-01-01 as a Thursday", () => {
    expect(dayOfWeekFromDays(0)).toBe(4);
  });

  test("reads the day before the epoch as a Wednesday", () => {
    expect(dayOfWeekFromDays(-1)).toBe(3);
  });

  test("runs Monday to Sunday as 1 to 7", () => {
    const monday = daysFromCivil(2026, 9, 28);
    expect(Array.from({ length: 7 }, (_, offset) => dayOfWeekFromDays(monday + offset))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("agrees with Date#getUTCDay far before the epoch", () => {
    const days = daysFromCivil(1066, 10, 14);
    expect(dayOfWeekFromDays(days) % 7).toBe(new Date(days * 86_400_000).getUTCDay());
  });
});
