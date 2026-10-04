import { expect, test } from "vitest";
import { isDateTimeParseError, isInvalidDateTimeError } from "./errors";
import { LocalDate } from "./local-date";
import { LocalDateTime } from "./local-date-time";
import { LocalTime } from "./local-time";

test("of combines a date and a time", () => {
  const date = LocalDate.of(2026, 10, 1);
  const time = LocalTime.of(14, 30);
  const value = LocalDateTime.of(date, time);
  expect(value.date).toBe(date);
  expect(value.time).toBe(time);
});

test("ofFields defaults the second and the millisecond to zero", () => {
  const value = LocalDateTime.ofFields(2026, 10, 1, 14, 30);
  expect(value.date.equals(LocalDate.of(2026, 10, 1))).toBe(true);
  expect(value.time.equals(LocalTime.of(14, 30, 0, 0))).toBe(true);
});

test("ofFields takes every field", () => {
  expect(LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, 250).toString()).toBe("2026-10-01T14:30:05.250");
});

test.each([
  ["February 30", [2026, 2, 30, 10, 0]],
  ["month 13", [2026, 13, 1, 10, 0]],
  ["day 0", [2026, 10, 0, 10, 0]],
  ["hour 24", [2026, 10, 1, 24, 0]],
  ["minute 60", [2026, 10, 1, 10, 60]],
  ["second 60", [2026, 10, 1, 10, 0, 60]],
] as const)("ofFields rejects %s with InvalidDateTimeError", (_name, fields) => {
  try {
    LocalDateTime.ofFields(...(fields as unknown as Parameters<typeof LocalDateTime.ofFields>));
    expect.unreachable();
  } catch (error) {
    expect(isInvalidDateTimeError(error)).toBe(true);
  }
});

test("instances are frozen", () => {
  expect(Object.isFrozen(LocalDateTime.ofFields(2026, 10, 1, 14, 30))).toBe(true);
});

test.each([
  "2026-10-01T14:30",
  "2026-10-01T14:30:05",
  "2026-10-01T14:30:05.250",
  "2026-10-01T00:00",
  "0001-01-01T00:00",
  "9999-12-31T23:59:59.999",
])("parse then toString round-trips %s", (iso) => {
  expect(LocalDateTime.parse(iso).toString()).toBe(iso);
  const result = LocalDateTime.tryParse(iso);
  expect(result.success).toBe(true);
  expect(result.value?.toString()).toBe(iso);
});

test("parse reads the fields of each form", () => {
  const value = LocalDateTime.parse("2026-10-01T14:30:05.25");
  expect(value.equals(LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, 250))).toBe(true);
});

test.each([
  "",
  "2026-10-01",
  "14:30",
  "2026-10-01 14:30",
  "2026-10-01t14:30",
  "2026-10-01T",
  "T14:30",
  "2026-10-01T14:30T",
  "2026-10-01TT14:30",
  "2026-02-30T10:00",
  "2026-13-01T10:00",
  "2026-10-01T24:00",
  "2026-10-01T10:60",
  "2026-10-01T10:00:60",
  "2026-10-01T10:00Z",
  " 2026-10-01T10:00",
])("parse rejects %j with DateTimeParseError and tryParse reports failure", (str) => {
  try {
    LocalDateTime.parse(str);
    expect.unreachable();
  } catch (error) {
    expect(isDateTimeParseError(error)).toBe(true);
    expect(isInvalidDateTimeError(error)).toBe(false);
  }
  expect(LocalDateTime.tryParse(str)).toEqual({ success: false });
});

test("compare orders by date, then by time", () => {
  const earlier = LocalDateTime.parse("2026-10-01T23:59");
  const later = LocalDateTime.parse("2026-10-02T00:00");
  const sameDayLater = LocalDateTime.parse("2026-10-01T23:59:00.001");
  expect(LocalDateTime.compare(earlier, later)).toBeLessThan(0);
  expect(LocalDateTime.compare(later, earlier)).toBeGreaterThan(0);
  expect(LocalDateTime.compare(earlier, sameDayLater)).toBeLessThan(0);
  expect(LocalDateTime.compare(sameDayLater, earlier)).toBeGreaterThan(0);
  expect(LocalDateTime.compare(earlier, LocalDateTime.parse("2026-10-01T23:59"))).toBe(0);
});

test("equals agrees with compare === 0", () => {
  const values = ["2026-10-01T14:30", "2026-10-01T14:30:05", "2026-10-02T14:30", "2026-10-01T14:31"].map((iso) => LocalDateTime.parse(iso));
  for (const a of values) {
    for (const b of values) {
      expect(a.equals(b)).toBe(LocalDateTime.compare(a, b) === 0);
    }
  }
});

test("dayOfWeek and lengthOfMonth delegate to the date", () => {
  const value = LocalDateTime.parse("2026-10-01T14:30");
  expect(value.dayOfWeek).toBe(4);
  expect(value.lengthOfMonth).toBe(31);
  expect(LocalDateTime.parse("2024-02-10T00:00").lengthOfMonth).toBe(29);
});

test("plusDays and minusDays carry the time unchanged", () => {
  const value = LocalDateTime.parse("2026-12-31T14:30:05.250");
  expect(value.plusDays(1).toString()).toBe("2027-01-01T14:30:05.250");
  expect(value.minusDays(365).toString()).toBe("2025-12-31T14:30:05.250");
  expect(value.plusDays(40).minusDays(40).equals(value)).toBe(true);
});

test("plusMonths and minusMonths clamp the day and carry the time unchanged", () => {
  expect(LocalDateTime.parse("2026-01-31T09:15").plusMonths(1).toString()).toBe("2026-02-28T09:15");
  expect(LocalDateTime.parse("2024-01-31T09:15").plusMonths(1).toString()).toBe("2024-02-29T09:15");
  expect(LocalDateTime.parse("2024-03-31T09:15:30").minusMonths(1).toString()).toBe("2024-02-29T09:15:30");
});

test("date arithmetic past the supported range throws InvalidDateTimeError", () => {
  try {
    LocalDateTime.parse("9999-12-31T10:00").plusDays(1);
    expect.unreachable();
  } catch (error) {
    expect(isInvalidDateTimeError(error)).toBe(true);
  }
});

test("date arithmetic rejects an amount that is not a safe integer", () => {
  const value = LocalDateTime.parse("2026-10-01T14:30");
  expect(() => value.plusDays(1.5)).toThrow(RangeError);
  expect(() => value.minusMonths(Number.NaN)).toThrow(RangeError);
});
