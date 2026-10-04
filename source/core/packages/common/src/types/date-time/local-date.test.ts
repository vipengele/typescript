import { describe, expect, test } from "vitest";
import { DateTimeParseError, InvalidDateTimeError, isDateTimeParseError, isInvalidDateTimeError } from "./errors";
import { LocalDate } from "./local-date";

const date = (str: string): LocalDate => LocalDate.parse(str);

describe("LocalDate.of", () => {
  test("holds the fields it is given", () => {
    const value = LocalDate.of(2026, 10, 1);

    expect([value.year, value.month, value.day]).toEqual([2026, 10, 1]);
  });

  test("accepts February 29 in a leap year", () => {
    expect(LocalDate.of(2024, 2, 29).toString()).toBe("2024-02-29");
  });

  test("accepts both ends of the supported range", () => {
    expect(LocalDate.of(1, 1, 1).toString()).toBe("0001-01-01");
    expect(LocalDate.of(9999, 12, 31).toString()).toBe("9999-12-31");
  });

  test.for([
    [2026, 2, 30],
    [2026, 2, 29],
    [1900, 2, 29],
    [2026, 4, 31],
    [2026, 13, 1],
    [2026, 0, 1],
    [2026, 1, 0],
    [2026, 1, 32],
    [0, 1, 1],
    [10_000, 1, 1],
    [2026.5, 1, 1],
    [2026, 1.5, 1],
    [2026, 1, 1.5],
    [Number.NaN, 1, 1],
    [2026, Number.POSITIVE_INFINITY, 1],
  ])("rejects %s-%s-%s with InvalidDateTimeError", ([year, month, day]) => {
    expect(() => LocalDate.of(year as number, month as number, day as number)).toThrow(InvalidDateTimeError);
  });

  test("names the offending field in the message", () => {
    expect(() => LocalDate.of(2026, 2, 30)).toThrow("day must be an integer from 1 to 28 in 2026-02, got 30");
    expect(() => LocalDate.of(2026, 13, 1)).toThrow("month must be an integer from 1 to 12, got 13");
    expect(() => LocalDate.of(0, 1, 1)).toThrow("year must be an integer from 1 to 9999, got 0");
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalDate.of(2026, 2, 30);
      expect.unreachable("LocalDate.of accepted February 30");
    } catch (error) {
      expect(isInvalidDateTimeError(error)).toBe(true);
    }
  });

  test("returns a frozen value", () => {
    const value = LocalDate.of(2026, 10, 1);

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as { day: number }).day = 2;
    }).toThrow(TypeError);
  });
});

describe("LocalDate.parse", () => {
  test.for(["2026-10-01", "2024-02-29", "0001-01-01", "9999-12-31", "1999-12-31"])("round-trips %s", (str) => {
    expect(LocalDate.parse(str).toString()).toBe(str);
  });

  test("reads the fields", () => {
    expect(LocalDate.parse("2026-10-01").equals(LocalDate.of(2026, 10, 1))).toBe(true);
  });

  test.for([
    "2026-02-30",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
    "0000-01-01",
    "2026-1-01",
    "2026-01-1",
    "26-01-01",
    "+2026-01-01",
    "-2026-01-01",
    "20260101",
    "2026/01/01",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01T00:00",
    "2026-W40-4",
    "",
    "nope",
  ])("rejects %o with DateTimeParseError", (str) => {
    expect(() => LocalDate.parse(str)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises, not InvalidDateTimeError", () => {
    try {
      LocalDate.parse("2026-02-30");
      expect.unreachable("LocalDate.parse accepted February 30");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
      expect(isInvalidDateTimeError(error)).toBe(false);
    }
  });

  test("quotes the input in the message", () => {
    expect(() => LocalDate.parse("nope")).toThrow('Cannot parse "nope" as an ISO 8601 date.');
  });
});

describe("LocalDate.tryParse", () => {
  test("returns the value on success", () => {
    const result = LocalDate.tryParse("2026-10-01");

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalDate.of(2026, 10, 1))).toBe(true);
  });

  test.for(["2026-02-30", "nope"])("returns { success: false } for %o", (str) => {
    expect(LocalDate.tryParse(str)).toEqual({ success: false });
  });
});

describe("LocalDate.compare and equals", () => {
  const ordered = ["2025-12-31", "2026-01-01", "2026-01-02", "2026-02-01", "2027-01-01"].map(date);

  test("orders by year, then month, then day", () => {
    expect([...ordered].reverse().sort(LocalDate.compare)).toEqual(ordered);
  });

  test("is zero exactly when equals holds", () => {
    for (const a of ordered) {
      for (const b of ordered) {
        expect(LocalDate.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDate.compare(a, b)) + Math.sign(LocalDate.compare(b, a))).toBe(0);
      }
    }
  });

  test("treats separately built instances of one date as equal", () => {
    expect(LocalDate.of(2026, 10, 1).equals(date("2026-10-01"))).toBe(true);
    expect(LocalDate.compare(LocalDate.of(2026, 10, 1), date("2026-10-01"))).toBe(0);
  });
});

describe("LocalDate day of the week", () => {
  test.for([
    ["2026-10-01", 4],
    ["2026-09-28", 1],
    ["2026-10-04", 7],
    ["2000-01-01", 6],
    ["1970-01-01", 4],
    ["0001-01-01", 1],
    ["9999-12-31", 5],
  ] as const)("%s is ISO day %i", ([str, dayOfWeek]) => {
    expect(date(str).dayOfWeek).toBe(dayOfWeek);
  });
});

describe("LocalDate#lengthOfMonth", () => {
  test.for([
    ["2026-01-15", 31],
    ["2026-02-01", 28],
    ["2024-02-01", 29],
    ["2026-04-30", 30],
  ] as const)("%s is in a %i-day month", ([str, length]) => {
    expect(date(str).lengthOfMonth).toBe(length);
  });
});

describe("LocalDate#plusDays and minusDays", () => {
  test.for([
    ["2026-10-01", 1, "2026-10-02"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-10-01", 0, "2026-10-01"],
    ["2026-10-01", -1, "2026-09-30"],
    ["2026-10-01", 365, "2027-10-01"],
    ["2024-01-01", 366, "2025-01-01"],
  ] as const)("%s plus %i days is %s", ([from, days, to]) => {
    expect(date(from).plusDays(days).toString()).toBe(to);
    expect(date(to).minusDays(days).toString()).toBe(from);
  });

  test("leaves the receiver unchanged", () => {
    const value = date("2026-10-01");
    value.plusDays(10);

    expect(value.toString()).toBe("2026-10-01");
  });

  test("throws InvalidDateTimeError past the end of the supported range", () => {
    expect(() => date("9999-12-31").plusDays(1)).toThrow(InvalidDateTimeError);
    expect(() => date("0001-01-01").minusDays(1)).toThrow(InvalidDateTimeError);
  });

  test.for([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects an amount of %s with RangeError", (amount) => {
    expect(() => date("2026-10-01").plusDays(amount)).toThrow(RangeError);
    expect(() => date("2026-10-01").minusDays(amount)).toThrow(RangeError);
  });
});

describe("LocalDate#plusMonths and minusMonths", () => {
  test.for([
    ["2026-10-01", 1, "2026-11-01"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2024-01-31", 1, "2024-02-29"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-10-01", 0, "2026-10-01"],
    ["2026-10-01", 12, "2027-10-01"],
    ["2026-10-01", -10, "2025-12-01"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
  ] as const)("%s plus %i months is %s", ([from, months, to]) => {
    expect(date(from).plusMonths(months).toString()).toBe(to);
  });

  test.for([
    ["2024-03-31", 1, "2024-02-29"],
    ["2026-03-31", 1, "2026-02-28"],
    ["2024-02-29", 12, "2023-02-28"],
    ["2026-01-15", 1, "2025-12-15"],
    ["2026-10-01", -3, "2027-01-01"],
  ] as const)("%s minus %i months is %s", ([from, months, to]) => {
    expect(date(from).minusMonths(months).toString()).toBe(to);
  });

  test("throws InvalidDateTimeError past the end of the supported range", () => {
    expect(() => date("9999-12-01").plusMonths(1)).toThrow(InvalidDateTimeError);
    expect(() => date("0001-01-31").minusMonths(1)).toThrow(InvalidDateTimeError);
  });

  test.for([1.5, Number.NaN, Number.NEGATIVE_INFINITY])("rejects an amount of %s with RangeError", (amount) => {
    expect(() => date("2026-10-01").plusMonths(amount)).toThrow(RangeError);
    expect(() => date("2026-10-01").minusMonths(amount)).toThrow(RangeError);
  });
});

describe("LocalDate#toString", () => {
  test("pads every field", () => {
    expect(LocalDate.of(987, 6, 5).toString()).toBe("0987-06-05");
  });

  test("is what a template literal writes", () => {
    expect(`${LocalDate.of(2026, 10, 1)}`).toBe("2026-10-01");
  });
});
