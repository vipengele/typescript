import { afterEach, describe, expect, test, vi } from "vitest";
import { civilFieldsAt } from "./civil-fields";

/** The epoch milliseconds of the instant `iso` spells. */
function epochOf(iso: string): number {
  return new Date(iso).getTime();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("civilFieldsAt", () => {
  test("reads an instant in UTC", () => {
    expect(civilFieldsAt("UTC", epochOf("2026-10-01T14:30:05.250Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 1,
      hour: 14,
      minute: 30,
      second: 5,
      nanosecond: 250_000_000,
    });
  });

  test("reads the same instant at each zone's own wall clock", () => {
    const instant = epochOf("2026-07-01T12:00:00.000Z");

    expect(civilFieldsAt("Europe/Berlin", instant)).toMatchObject({ day: 1, hour: 14, minute: 0 });
    expect(civilFieldsAt("America/New_York", instant)).toMatchObject({ day: 1, hour: 8, minute: 0 });
  });

  test("reads a year of 1 BC as year 0", () => {
    expect(civilFieldsAt("UTC", epochOf("0000-06-15T12:00:00.000Z"))).toEqual({
      year: 0,
      month: 6,
      day: 15,
      hour: 12,
      minute: 0,
      second: 0,
      nanosecond: 0,
    });
    // Berlin's local mean time is 53 min 28 s ahead of UTC.
    expect(civilFieldsAt("Europe/Berlin", epochOf("0000-06-15T12:00:00.000Z"))).toEqual({
      year: 0,
      month: 6,
      day: 15,
      hour: 12,
      minute: 53,
      second: 28,
      nanosecond: 0,
    });
    expect(civilFieldsAt("UTC", epochOf("-000001-06-15T12:00:00.000Z"))).toMatchObject({ year: -1, month: 6, day: 15 });
  });

  test("reads the first instant of year 1 behind UTC as the last day of 1 BC", () => {
    expect(civilFieldsAt("UTC", epochOf("0001-01-01T00:00:00.000Z"))).toEqual({
      year: 1,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      nanosecond: 0,
    });
    // New York's local mean time is 4 h 56 min 2 s behind UTC.
    expect(civilFieldsAt("America/New_York", epochOf("0001-01-01T00:00:00.000Z"))).toEqual({
      year: 0,
      month: 12,
      day: 31,
      hour: 19,
      minute: 3,
      second: 58,
      nanosecond: 0,
    });
  });

  test("reads the last instant of year 9999 ahead of UTC as year 10000", () => {
    expect(civilFieldsAt("UTC", epochOf("9999-12-31T23:59:59.999Z"))).toEqual({
      year: 9999,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_000_000,
    });
    expect(civilFieldsAt("Europe/Berlin", epochOf("9999-12-31T23:59:59.999Z"))).toEqual({
      year: 10000,
      month: 1,
      day: 1,
      hour: 0,
      minute: 59,
      second: 59,
      nanosecond: 999_000_000,
    });
  });

  test("reads year 10000", () => {
    expect(civilFieldsAt("UTC", epochOf("+010000-01-01T00:00:00.000Z"))).toEqual({
      year: 10000,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      nanosecond: 0,
    });
    expect(civilFieldsAt("America/New_York", epochOf("+010000-01-01T00:00:00.000Z"))).toEqual({
      year: 9999,
      month: 12,
      day: 31,
      hour: 19,
      minute: 0,
      second: 0,
      nanosecond: 0,
    });
  });

  test("reads an instant before a zone's first transition in its local mean time", () => {
    expect(civilFieldsAt("Europe/Berlin", epochOf("1800-01-01T00:00:00.000Z"))).toMatchObject({
      year: 1800,
      month: 1,
      day: 1,
      hour: 0,
      minute: 53,
      second: 28,
    });
  });

  test("carries the fraction of the instant through, floored to the microsecond", () => {
    // 0.4375 is 7/16, exact in a double at this magnitude: 123 437.5 µs floors to 123 437.
    expect(civilFieldsAt("UTC", epochOf("2026-10-01T14:30:05.123Z") + 0.4375)).toMatchObject({ second: 5, nanosecond: 123_437_000 });
    // -2^-11 ms is -0.48828125 µs, exact in a double; it floors to -1 µs, into 1969.
    expect(civilFieldsAt("UTC", -(2 ** -11))).toEqual({
      year: 1969,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_999_000,
    });
    // -1e-20 ms leaves a remainder that rounds to exactly 1 ms; it is the millisecond's last microsecond.
    expect(civilFieldsAt("UTC", -1e-20)).toMatchObject({ year: 1969, second: 59, nanosecond: 999_999_000 });
  });

  test.for([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15 + 1, -8.64e15 - 1])(
    "rejects an instant of %s with RangeError",
    (epochMilliseconds) => {
      expect(() => civilFieldsAt("UTC", epochMilliseconds)).toThrow(RangeError);
    },
  );

  test("rejects a time zone Intl does not recognize with RangeError", () => {
    expect(() => civilFieldsAt("Not/A_Zone", 0)).toThrow(RangeError);
  });
});

describe("civilFieldsAt formatter cache", () => {
  /** The number of formatters built for a zone, by zone. */
  function spyOnZonedFormatters(): (timeZone: string) => number {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    // `civilFieldsAt` calls the spy with `new`, which an arrow function cannot answer.
    // biome-ignore lint/complexity/useArrowFunction: the implementation must be constructible
    const construct = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return Reflect.construct(RealDateTimeFormat, args);
    };
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(construct as unknown as typeof Intl.DateTimeFormat);
    return (timeZone) => spy.mock.calls.filter(([, options]) => options?.timeZone === timeZone).length;
  }

  // The cache is module-level and outlives each test, so these zones appear in no other test.
  test("builds one formatter per zone, not per call", () => {
    const zonedFormatters = spyOnZonedFormatters();

    civilFieldsAt("Asia/Kathmandu", epochOf("2026-10-01T12:30:00.000Z"));
    civilFieldsAt("Asia/Kathmandu", epochOf("1800-01-01T00:00:00.000Z"));
    civilFieldsAt("Asia/Kathmandu", epochOf("+010000-01-01T00:00:00.000Z"));
    expect(zonedFormatters("Asia/Kathmandu")).toBe(1);

    civilFieldsAt("Pacific/Chatham", 0);
    civilFieldsAt("Asia/Kathmandu", 0);
    civilFieldsAt("Pacific/Chatham", 1);
    expect(zonedFormatters("Pacific/Chatham")).toBe(1);
    expect(zonedFormatters("Asia/Kathmandu")).toBe(1);
  });
});
