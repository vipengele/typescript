import { describe, expect, test } from "vitest";
import {
  DateTimeParseError,
  InvalidDateTimeError,
  isDateTimeParseError,
  isInvalidDateTimeError,
  LocalDate,
  LocalDateTime,
  LocalTime,
} from "./index";

const DATES = [
  "0001-01-01",
  "1900-03-01",
  "1970-01-01",
  "2000-02-29",
  "2023-02-28",
  "2024-02-28",
  "2024-02-29",
  "2024-12-31",
  "2026-10-01",
  "9999-12-31",
];
const TIMES = [
  "00:00",
  "00:01",
  "12:30",
  "23:59",
  "00:00:01",
  "14:30:05",
  "23:59:59",
  "00:00:00.001",
  "14:30:05.250",
  "23:59:59.999",
  "10:00:00.050",
];
const DATE_TIMES = DATES.flatMap((date) => TIMES.map((time) => `${date}T${time}`));
const AMOUNTS = [0, 1, 2, 7, 28, 29, 30, 31, 59, 60, 365, 366, 1461, 36524, 146097, 365000];

function throwsInvalid(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(isInvalidDateTimeError(thrown)).toBe(true);
  expect(thrown).toBeInstanceOf(InvalidDateTimeError);
}

function throwsParse(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(isDateTimeParseError(thrown)).toBe(true);
  expect(thrown).toBeInstanceOf(DateTimeParseError);
}

describe("ISO parse then format round-trips", () => {
  test.each(DATES)("LocalDate %s", (text) => {
    expect(LocalDate.parse(text).toString()).toBe(text);
  });

  test.each(TIMES)("LocalTime %s", (text) => {
    expect(LocalTime.parse(text).toString()).toBe(text);
  });

  test("LocalTime without seconds or fraction keeps the short form", () => {
    expect(LocalTime.parse("14:30:00").toString()).toBe("14:30");
    expect(LocalTime.parse("14:30:05.000").toString()).toBe("14:30:05");
  });

  test("LocalTime pads a short fraction as a decimal of a second", () => {
    expect(LocalTime.parse("14:30:05.5").toString()).toBe("14:30:05.500");
    expect(LocalTime.parse("14:30:05.05").toString()).toBe("14:30:05.050");
  });

  test.each(DATE_TIMES)("LocalDateTime %s", (text) => {
    expect(LocalDateTime.parse(text).toString()).toBe(text);
  });

  test("formatting then parsing yields an equal value", () => {
    const value = LocalDateTime.ofFields(2024, 2, 29, 23, 59, 59, 999);
    expect(LocalDateTime.parse(value.toString()).equals(value)).toBe(true);
  });
});

describe("plusDays(n).minusDays(n) is the identity", () => {
  const starts = ["2024-02-28", "2024-12-31", "2023-02-28", "2000-02-29", "1900-03-01", "2026-10-01", "2024-01-01"];

  test.each(starts)("LocalDate %s", (text) => {
    const start = LocalDate.parse(text);
    for (const amount of AMOUNTS) {
      expect(start.plusDays(amount).minusDays(amount).equals(start)).toBe(true);
      expect(start.minusDays(amount).plusDays(amount).equals(start)).toBe(true);
      expect(start.plusDays(-amount).minusDays(-amount).equals(start)).toBe(true);
    }
  });

  test.each(starts)("LocalDateTime %s keeps the time of day", (text) => {
    const start = LocalDateTime.parse(`${text}T13:45:10.123`);
    for (const amount of AMOUNTS) {
      expect(start.plusDays(amount).minusDays(amount).equals(start)).toBe(true);
    }
  });

  test("a single day crosses month, year and leap-day boundaries", () => {
    expect(LocalDate.parse("2024-02-28").plusDays(1).toString()).toBe("2024-02-29");
    expect(LocalDate.parse("2024-02-29").plusDays(1).toString()).toBe("2024-03-01");
    expect(LocalDate.parse("2023-02-28").plusDays(1).toString()).toBe("2023-03-01");
    expect(LocalDate.parse("2024-12-31").plusDays(1).toString()).toBe("2025-01-01");
    expect(LocalDate.parse("1900-03-01").minusDays(1).toString()).toBe("1900-02-28");
    expect(LocalDate.parse("2000-03-01").minusDays(1).toString()).toBe("2000-02-29");
  });
});

describe("compare agrees with equals", () => {
  const dates = DATES.map((text) => LocalDate.parse(text));
  const times = TIMES.map((text) => LocalTime.parse(text));
  const dateTimes = DATES.flatMap((date) =>
    ["00:00", "12:30:15.500", "23:59:59.999"].map((time) => LocalDateTime.parse(`${date}T${time}`)),
  );

  test("LocalDate", () => {
    for (const a of dates) {
      for (const b of dates) {
        expect(LocalDate.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDate.compare(a, b)) === -Math.sign(LocalDate.compare(b, a))).toBe(true);
      }
    }
  });

  test("LocalTime", () => {
    for (const a of times) {
      for (const b of times) {
        expect(LocalTime.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalTime.compare(a, b)) === -Math.sign(LocalTime.compare(b, a))).toBe(true);
      }
    }
  });

  test("date-times", () => {
    for (const a of dateTimes) {
      for (const b of dateTimes) {
        expect(LocalDateTime.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDateTime.compare(a, b)) === -Math.sign(LocalDateTime.compare(b, a))).toBe(true);
      }
    }
  });

  test("equal values built separately compare as zero", () => {
    expect(LocalDate.compare(LocalDate.of(2026, 10, 1), LocalDate.parse("2026-10-01"))).toBe(0);
    expect(LocalTime.compare(LocalTime.of(14, 30), LocalTime.parse("14:30:00.000"))).toBe(0);
    expect(LocalDateTime.compare(LocalDateTime.ofFields(2026, 10, 1, 14, 30), LocalDateTime.parse("2026-10-01T14:30"))).toBe(0);
  });

  test("ordering follows chronology", () => {
    const sorted = dates.map(String);
    expect([...dates].sort(LocalDate.compare).map(String)).toEqual(sorted);
    expect([...dates].reverse().sort(LocalDate.compare).map(String)).toEqual(sorted);
  });
});

describe("out-of-range fields are rejected", () => {
  test("by of(...) with InvalidDateTimeError", () => {
    throwsInvalid(() => LocalDate.of(2026, 2, 30));
    throwsInvalid(() => LocalDate.of(2023, 2, 29));
    throwsInvalid(() => LocalDate.of(2026, 13, 1));
    throwsInvalid(() => LocalDate.of(2026, 10, 0));
    throwsInvalid(() => LocalTime.of(24, 0));
    throwsInvalid(() => LocalTime.of(12, 60));
    throwsInvalid(() => LocalTime.of(12, 0, 60));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 2, 30, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 13, 1, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 0, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 24, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 10, 60));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 10, 0, 60));
  });

  test("by parse with DateTimeParseError", () => {
    throwsParse(() => LocalDate.parse("2026-02-30"));
    throwsParse(() => LocalDate.parse("2023-02-29"));
    throwsParse(() => LocalDate.parse("2026-13-01"));
    throwsParse(() => LocalDate.parse("2026-10-00"));
    throwsParse(() => LocalTime.parse("24:00"));
    throwsParse(() => LocalTime.parse("12:60"));
    throwsParse(() => LocalTime.parse("12:00:60"));
    throwsParse(() => LocalDateTime.parse("2026-02-30T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-13-01T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-00T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T24:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T10:60"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T10:00:60"));
  });

  test("by tryParse without throwing", () => {
    expect(LocalDate.tryParse("2026-02-30")).toEqual({ success: false });
    expect(LocalTime.tryParse("24:00")).toEqual({ success: false });
    expect(LocalDateTime.tryParse("2026-10-01T10:60")).toEqual({ success: false });
  });
});

describe("plusMonths and minusMonths clamp the day", () => {
  test.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2023-01-31", 1, "2023-02-28"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2023-03-31", -1, "2023-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", -12, "2023-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
    ["2024-01-31", 3, "2024-04-30"],
    ["2024-10-31", 4, "2025-02-28"],
    ["2024-12-31", 2, "2025-02-28"],
    ["2024-01-15", -1, "2023-12-15"],
  ] as const)("%s plus %i months is %s", (start, months, expected) => {
    expect(LocalDate.parse(start).plusMonths(months).toString()).toBe(expected);
    expect(LocalDate.parse(start).minusMonths(-months).toString()).toBe(expected);
    expect(LocalDateTime.parse(`${start}T08:15`).plusMonths(months).toString()).toBe(`${expected}T08:15`);
  });
});

describe("dayOfWeek agrees with known dates", () => {
  test.each([
    ["2026-10-01", 4],
    ["1970-01-01", 4],
    ["2000-01-01", 6],
    ["2024-02-29", 4],
    ["0001-01-01", 1],
    ["9999-12-31", 5],
    ["2026-10-04", 7],
  ] as const)("%s is ISO day %i", (text, expected) => {
    expect(LocalDate.parse(text).dayOfWeek).toBe(expected);
    expect(LocalDateTime.parse(`${text}T12:00`).dayOfWeek).toBe(expected);
  });

  test("seven days later is the same day of the week", () => {
    const start = LocalDate.parse("2024-02-26");
    for (let offset = 0; offset < 400; offset++) {
      const date = start.plusDays(offset);
      expect(date.plusDays(7).dayOfWeek).toBe(date.dayOfWeek);
    }
  });
});
