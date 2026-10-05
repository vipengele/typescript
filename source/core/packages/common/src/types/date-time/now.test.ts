import { afterEach, describe, expect, test, vi } from "vitest";
import { InvalidDateTimeError } from "./errors";
import { LocalDate } from "./local-date";
import { LocalDateTime } from "./local-date-time";
import { LocalTime } from "./local-time";
import { civilNow } from "./now";

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

/**
 * Makes `Intl.DateTimeFormat().resolvedOptions()` report `timeZone` as the runtime's zone. The
 * conversion itself formats with an explicit zone and never calls `resolvedOptions`, so it stays
 * the runtime's real `Intl`, identical in node and chromium.
 */
function useZone(timeZone: string): void {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone };
  });
}

/** A clock pinned to the instant `iso` spells, `fraction` milliseconds later. */
function clockAt(iso: string, fraction = 0): () => number {
  return () => new Date(iso).getTime() + fraction;
}

/**
 * Makes `systemClock` read `epochMilliseconds`. The time origin is pinned to zero so the reading
 * is exactly the mocked `performance.now()`, with no rounding from adding the real origin.
 */
function useSystemClock(epochMilliseconds: number): void {
  vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(0);
  vi.spyOn(performance, "now").mockReturnValue(epochMilliseconds);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("civilNow", () => {
  test("reads midnight as hour 0, never 24", () => {
    useZone("UTC");

    expect(civilNow(clockAt("2026-10-01T00:00:00.000Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      nanosecond: 0,
    });
  });

  test("reads local midnight as hour 0 in a zone ahead of UTC", () => {
    useZone("Pacific/Auckland");

    expect(civilNow(clockAt("2026-09-30T11:00:00.000Z"))).toMatchObject({ year: 2026, month: 10, day: 1, hour: 0 });
  });

  test("reads the date a zone ahead of UTC is already on", () => {
    const clock = clockAt("2026-10-01T12:30:00.000Z");

    useZone("UTC");
    expect(civilNow(clock)).toMatchObject({ year: 2026, month: 10, day: 1, hour: 12, minute: 30 });

    useZone("Pacific/Auckland");
    expect(civilNow(clock)).toMatchObject({ year: 2026, month: 10, day: 2, hour: 1, minute: 30 });
  });

  test("reads the date a zone behind UTC is still on", () => {
    useZone("America/Los_Angeles");

    expect(civilNow(clockAt("2026-10-01T05:00:00.000Z"))).toMatchObject({ year: 2026, month: 9, day: 30, hour: 22, minute: 0 });
  });

  test("reads the zone on every call", () => {
    const clock = clockAt("2026-10-01T05:00:00.000Z");

    useZone("Pacific/Auckland");
    const ahead = civilNow(clock);
    useZone("America/Los_Angeles");
    const behind = civilNow(clock);

    expect([ahead.day, ahead.hour]).toEqual([1, 18]);
    expect([behind.day, behind.hour]).toEqual([30, 22]);
  });

  test("takes the fraction of the second from the instant", () => {
    useZone("UTC");

    expect(civilNow(clockAt("2026-10-01T14:30:05.250Z"))).toMatchObject({ hour: 14, minute: 30, second: 5, nanosecond: 250_000_000 });
  });

  test("floors a sub-millisecond reading to the microsecond, never rounding it", () => {
    useZone("UTC");

    // 0.4375 is 7/16, exact in a double at this magnitude, and so is the reading times 1000:
    // 123 437.5 µs, which floors to 123 437 where rounding would give 123 438.
    expect(civilNow(clockAt("2026-10-01T14:30:05.123Z", 0.4375))).toMatchObject({ second: 5, nanosecond: 123_437_000 });
    // 2^-9 ms is 1.953125 µs, exact in a double.
    expect(civilNow(() => 2 ** -9)).toEqual({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, nanosecond: 1000 });
    expect(civilNow(() => 1.75)).toMatchObject({ year: 1970, second: 0, nanosecond: 1_750_000 });
  });

  test("leaves the last three digits of the nanosecond at zero", () => {
    useZone("UTC");

    for (const fraction of [0.4375, 2 ** -9, 0.999_999_9]) {
      expect(civilNow(clockAt("2026-10-01T14:30:05.123Z", fraction)).nanosecond % 1000).toBe(0);
    }
  });

  test("reads an instant before the epoch with a fraction from 0 to 999 999 000", () => {
    useZone("UTC");

    expect(civilNow(() => -1)).toEqual({ year: 1969, month: 12, day: 31, hour: 23, minute: 59, second: 59, nanosecond: 999_000_000 });
    expect(civilNow(() => -1002)).toMatchObject({ second: 58, nanosecond: 998_000_000 });
  });

  test("floors a sub-microsecond reading before the epoch into 1969", () => {
    useZone("UTC");

    // -2^-11 ms is -0.48828125 µs, exact in a double; it floors to -1 µs, not to 0.
    expect(civilNow(() => -(2 ** -11))).toEqual({
      year: 1969,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_999_000,
    });
  });

  test("puts a reading a hair below a whole millisecond in the millisecond's last microsecond", () => {
    useZone("UTC");

    // -1e-20 ms floors to -1 ms, and the remainder 1 - 1e-20 rounds to exactly 1 in a double:
    // scaled, that is 1000 µs, one past the last microsecond of the millisecond.
    expect(civilNow(() => -1e-20)).toEqual({
      year: 1969,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_999_000,
    });
  });

  test("reads a whole-millisecond instant far from the epoch to the exact millisecond", () => {
    useZone("UTC");

    // Each reading is a whole number of milliseconds, a safe integer and so exact in a double,
    // while the same reading in microseconds is past 2^53 and is not.
    expect(civilNow(clockAt("9999-12-31T23:59:59.005Z"))).toEqual({
      year: 9999,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 5_000_000,
    });
    expect(civilNow(clockAt("9999-12-31T23:59:59.999Z"))).toMatchObject({ second: 59, nanosecond: 999_000_000 });
    expect(civilNow(clockAt("5000-06-15T12:00:00.005Z"))).toEqual({
      year: 5000,
      month: 6,
      day: 15,
      hour: 12,
      minute: 0,
      second: 0,
      nanosecond: 5_000_000,
    });
  });

  test("rolls into the next year ahead of UTC", () => {
    useZone("Pacific/Auckland");

    expect(civilNow(clockAt("2024-12-31T23:30:00.000Z"))).toMatchObject({ year: 2025, month: 1, day: 1, hour: 12, minute: 30 });
  });

  test("stays in the previous year behind UTC", () => {
    useZone("America/Los_Angeles");

    expect(civilNow(clockAt("2026-01-01T03:00:00.000Z"))).toMatchObject({ year: 2025, month: 12, day: 31, hour: 19 });
  });

  test("reads February 29 on either side of UTC in a leap year", () => {
    useZone("Pacific/Auckland");
    expect(civilNow(clockAt("2024-02-28T12:00:00.000Z"))).toMatchObject({ year: 2024, month: 2, day: 29, hour: 1 });

    useZone("America/Los_Angeles");
    expect(civilNow(clockAt("2024-03-01T05:00:00.000Z"))).toMatchObject({ year: 2024, month: 2, day: 29, hour: 21 });
  });

  test("reads a year before the common era as a proleptic Gregorian year", () => {
    useZone("UTC");

    expect(civilNow(clockAt("0001-01-01T00:00:00.000Z"))).toMatchObject({ year: 1, month: 1, day: 1 });
    expect(civilNow(clockAt("0000-06-15T12:00:00.000Z"))).toMatchObject({ year: 0, month: 6, day: 15, hour: 12 });
    expect(civilNow(clockAt("-000001-06-15T12:00:00.000Z"))).toMatchObject({ year: -1, month: 6, day: 15 });
  });

  test.for([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15 + 1, -8.64e15 - 1])(
    "rejects a clock reading of %s with RangeError",
    (reading) => {
      expect(() => civilNow(() => reading)).toThrow(RangeError);
    },
  );

  test("accepts both ends of the time value range", () => {
    useZone("UTC");

    expect(civilNow(() => 8.64e15)).toMatchObject({ year: 275760, month: 9, day: 13 });
    expect(civilNow(() => -8.64e15)).toMatchObject({ year: -271821, month: 4, day: 20 });
  });

  test("reads the system clock by default", () => {
    useZone("UTC");
    useSystemClock(new Date("2026-10-01T14:30:05.250Z").getTime() + 0.5);

    expect(civilNow()).toEqual({ year: 2026, month: 10, day: 1, hour: 14, minute: 30, second: 5, nanosecond: 250_500_000 });
  });
});

describe("civilNow formatter cache", () => {
  /** The number of formatters built for an explicit zone, which `civilNow` builds once per zone. */
  function spyOnZonedFormatters(): () => number {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    // `civilNow` calls the spy with `new`, which an arrow function cannot answer.
    // biome-ignore lint/complexity/useArrowFunction: the implementation must be constructible
    const construct = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return Reflect.construct(RealDateTimeFormat, args);
    };
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(construct as unknown as typeof Intl.DateTimeFormat);
    // `useZone` patches the prototype reached through `Intl.DateTimeFormat`, which the spy would otherwise hide.
    Object.defineProperty(Intl.DateTimeFormat, "prototype", { value: RealDateTimeFormat.prototype });
    return () => spy.mock.calls.filter(([, options]) => options?.timeZone !== undefined).length;
  }

  test("builds one formatter per zone and reuses it", () => {
    const clock = clockAt("2026-10-01T12:30:00.000Z");
    useZone("Asia/Tokyo");
    const zonedFormatters = spyOnZonedFormatters();

    civilNow(clock);
    civilNow(clock);
    expect(zonedFormatters()).toBe(1);

    useZone("Australia/Perth");
    civilNow(clock);
    civilNow(clock);
    expect(zonedFormatters()).toBe(2);
  });
});

describe("LocalDate.now", () => {
  test("is the date in the runtime's zone", () => {
    useZone("Pacific/Auckland");

    expect(LocalDate.now(clockAt("2026-10-01T12:30:00.000Z"))).toEqual(LocalDate.of(2026, 10, 2));
  });

  test("reads the system clock by default", () => {
    useZone("UTC");
    useSystemClock(new Date("2024-02-29T12:00:00.000Z").getTime());

    expect(LocalDate.now()).toEqual(LocalDate.of(2024, 2, 29));
  });

  test("rejects a date outside 0001-01-01 to 9999-12-31 with InvalidDateTimeError", () => {
    useZone("UTC");

    expect(() => LocalDate.now(clockAt("0000-12-31T23:59:59.999Z"))).toThrow(InvalidDateTimeError);
    expect(() => LocalDate.now(clockAt("+010000-01-01T00:00:00.000Z"))).toThrow(InvalidDateTimeError);
  });
});

describe("LocalTime.now", () => {
  test("is the time of day in the runtime's zone, to the microsecond", () => {
    useZone("America/Los_Angeles");

    // 0.4375 ms is exact in a double, and floors to 437 µs.
    const time = LocalTime.now(clockAt("2026-10-01T05:06:07.089Z", 0.4375));
    expect(time).toEqual(LocalTime.of(22, 6, 7, 89_437_000));
    expect(time.toString()).toBe("22:06:07.089437");
    expect(Object.isFrozen(time)).toBe(true);
  });

  test("is 00:00 at midnight", () => {
    useZone("UTC");

    expect(LocalTime.now(clockAt("2026-10-01T00:00:00.000Z")).toString()).toBe("00:00");
  });

  test("reads the system clock by default", () => {
    useZone("UTC");
    useSystemClock(new Date("2026-10-01T14:30:05.250Z").getTime() + 0.5);

    expect(LocalTime.now()).toEqual(LocalTime.of(14, 30, 5, 250_500_000));
  });
});

describe("LocalDateTime.now", () => {
  test("is the date and time of day in the runtime's zone", () => {
    useZone("Pacific/Auckland");

    expect(LocalDateTime.now(clockAt("2024-12-31T23:30:00.125Z")).toString()).toBe("2025-01-01T12:30:00.125");
  });

  test("is to the microsecond, floored", () => {
    useZone("UTC");

    // 0.4375 ms is exact in a double; the reading floors to 123 437 µs rather than rounding up.
    const value = LocalDateTime.now(clockAt("2026-10-01T14:30:00.123Z", 0.4375));
    expect(value.toString()).toBe("2026-10-01T14:30:00.123437");
    expect(value.time.nanosecond).toBe(123_437_000);
    expect(Object.isFrozen(value)).toBe(true);
  });

  test("writes a single microsecond as a six-digit fraction", () => {
    useZone("UTC");

    // 2^-9 ms is 1.953125 µs, exact in a double, and floors to 1 µs.
    expect(LocalDateTime.now(() => 2 ** -9).toString()).toBe("1970-01-01T00:00:00.000001");
  });

  test("is midnight at hour 0", () => {
    useZone("UTC");

    expect(LocalDateTime.now(clockAt("2026-10-01T00:00:00.000Z")).time.hour).toBe(0);
  });

  test("reads the clock once for both the date and the time", () => {
    useZone("UTC");
    const clock = vi.fn(clockAt("2026-10-01T23:59:59.999Z"));

    expect(LocalDateTime.now(clock).toString()).toBe("2026-10-01T23:59:59.999");
    expect(clock).toHaveBeenCalledTimes(1);
  });

  test("reads the system clock by default", () => {
    useZone("UTC");
    useSystemClock(new Date("2026-10-01T00:00:00.000Z").getTime() + 0.5);

    expect(LocalDateTime.now().toString()).toBe("2026-10-01T00:00:00.000500");
  });

  test("rejects a date outside 0001-01-01 to 9999-12-31 with InvalidDateTimeError", () => {
    useZone("UTC");

    expect(() => LocalDateTime.now(clockAt("+010000-01-01T00:00:00.000Z"))).toThrow(InvalidDateTimeError);
  });
});
