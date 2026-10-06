import { afterEach, describe, expect, test, vi } from "vitest";
import { DateTimeParseError, isDateTimeParseError, isInvalidDateTimeError } from "./errors";
import { Instant } from "./instant";
import { ZoneId } from "./zone-id";
import type { ZonedDateTime } from "./zoned-date-time";

/** The largest distance from the epoch, in seconds, an instant spans. */
const MAX_SECOND = 8_640_000_000_000;

/** The largest distance from the epoch, in milliseconds, an instant spans. */
const MAX_MILLI = 8.64e15;

const MIN = Instant.ofEpochSecond(-MAX_SECOND);
const MAX = Instant.ofEpochSecond(MAX_SECOND);

/** The epoch second and nanosecond of `instant`, for a single assertion on both. */
function parts(instant: Instant): [number, number] {
  return [instant.toEpochSecond(), instant.nanosecond];
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

describe("Instant.ofEpochSecond", () => {
  test("holds the second and the nanosecond it is given", () => {
    expect(parts(Instant.ofEpochSecond(1_790_000_000, 123_456_789))).toEqual([1_790_000_000, 123_456_789]);
  });

  test("defaults the nanosecond to zero", () => {
    expect(Instant.ofEpochSecond(-5).nanosecond).toBe(0);
  });

  test("accepts both ends of the range", () => {
    expect(parts(MAX)).toEqual([MAX_SECOND, 0]);
    expect(parts(MIN)).toEqual([-MAX_SECOND, 0]);
    expect(parts(Instant.ofEpochSecond(-MAX_SECOND, 999_999_999))).toEqual([-MAX_SECOND, 999_999_999]);
    expect(parts(Instant.ofEpochSecond(MAX_SECOND - 1, 999_999_999))).toEqual([MAX_SECOND - 1, 999_999_999]);
  });

  test.for([
    [MAX_SECOND + 1, 0],
    [-MAX_SECOND - 1, 0],
    [-MAX_SECOND - 1, 999_999_999],
    [MAX_SECOND, 1],
    [1.5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [0, -1],
    [0, 1_000_000_000],
    [0, 1.5],
    [0, Number.NaN],
  ])("rejects second %s with nanosecond %s as a RangeError", ([second, nano]) => {
    expect(() => Instant.ofEpochSecond(second as number, nano)).toThrow(RangeError);
  });

  test("never carries the nanosecond into the second", () => {
    expect(() => Instant.ofEpochSecond(0, 1_500_000_000)).toThrow("The nanosecond must be an integer from 0 to 999999999, got 1500000000.");
  });

  test("returns a frozen value", () => {
    const value = Instant.ofEpochSecond(1, 2);

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as unknown as { nano: number }).nano = 3;
    }).toThrow(TypeError);
  });
});

describe("Instant.ofEpochMilli", () => {
  test("splits the milliseconds into a second and a nanosecond exactly", () => {
    expect(parts(Instant.ofEpochMilli(1_790_000_000_123))).toEqual([1_790_000_000, 123_000_000]);
    expect(parts(Instant.ofEpochMilli(-1))).toEqual([-1, 999_000_000]);
    expect(parts(Instant.ofEpochMilli(-1000))).toEqual([-1, 0]);
    expect(parts(Instant.ofEpochMilli(-1001))).toEqual([-2, 999_000_000]);
  });

  test("accepts ±8.64e15 exactly", () => {
    expect(Instant.ofEpochMilli(MAX_MILLI).equals(MAX)).toBe(true);
    expect(Instant.ofEpochMilli(-MAX_MILLI).equals(MIN)).toBe(true);
  });

  test.for([MAX_MILLI + 1, -MAX_MILLI - 1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY])("rejects %s as a RangeError", (milli) => {
    expect(() => Instant.ofEpochMilli(milli)).toThrow(RangeError);
  });
});

describe("Instant#toEpochMilli", () => {
  test.for([
    [-1, 999_999_999, -1],
    [-1, 0, -1000],
    [-1, 1, -1000],
    [0, 999_999, 0],
    [1, 1_000_000, 1001],
    [MAX_SECOND, 0, MAX_MILLI],
    [-MAX_SECOND, 0, -MAX_MILLI],
  ])("floors second %s with nanosecond %s to %s", ([second, nano, milli]) => {
    expect(Instant.ofEpochSecond(second as number, nano).toEpochMilli()).toBe(milli);
  });
});

describe("Instant.now", () => {
  test("reads the pinned clock to the microsecond", () => {
    expect(parts(Instant.now(() => 1_000.25))).toEqual([1, 250_000]);
    expect(parts(Instant.now(() => 1_790_000_000_123))).toEqual([1_790_000_000, 123_000_000]);
  });

  test("floors a fractional millisecond to the microsecond, never rounding", () => {
    expect(parts(Instant.now(() => 1.0009765625))).toEqual([0, 1_000_000]);
    expect(parts(Instant.now(() => 1.7509765625))).toEqual([0, 1_750_000]);
  });

  test("floors a reading before the epoch towards the past", () => {
    expect(parts(Instant.now(() => -0.5))).toEqual([-1, 999_500_000]);
    expect(parts(Instant.now(() => -1500))).toEqual([-2, 500_000_000]);
  });

  test("puts a reading a hair below a whole millisecond in its last microsecond", () => {
    expect(parts(Instant.now(() => -1e-17))).toEqual([-1, 999_999_000]);
  });

  test("reads both ends of the range exactly", () => {
    expect(Instant.now(() => MAX_MILLI).equals(MAX)).toBe(true);
    expect(Instant.now(() => -MAX_MILLI).equals(MIN)).toBe(true);
  });

  test.for([MAX_MILLI + 1, -MAX_MILLI - 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a clock reading %s as a RangeError",
    (reading) => {
      expect(() => Instant.now(() => reading)).toThrow(RangeError);
    },
  );

  test("reads the system clock by default", () => {
    useSystemClock(1_790_000_000_123.5);

    expect(parts(Instant.now())).toEqual([1_790_000_000, 123_500_000]);
  });
});

describe("Instant.parse", () => {
  test.for([
    "2026-10-01T12:30:00Z",
    "2026-10-01T12:30:00.123Z",
    "2026-10-01T12:30:00.123456Z",
    "2026-10-01T12:30:00.123456789Z",
    "2026-10-01T12:30:00.000000001Z",
    "1970-01-01T00:00:00Z",
    "1969-12-31T23:59:59.999999999Z",
    "2024-02-29T23:59:59.999Z",
    "0001-01-01T00:00:00Z",
    "0000-02-29T00:00:00Z",
    "9999-12-31T23:59:59.999999999Z",
    "+010000-01-01T00:00:00Z",
    "-000001-12-31T23:59:59Z",
    "+275760-09-13T00:00:00Z",
    "-271821-04-20T00:00:00Z",
    "-271821-04-20T00:00:00.000000001Z",
    "+275760-09-12T23:59:59.999999999Z",
  ])("round-trips %s", (text) => {
    expect(Instant.parse(text).toString()).toBe(text);
  });

  test("reads the range bounds in the expanded-year form", () => {
    expect(Instant.parse("+275760-09-13T00:00:00Z").equals(MAX)).toBe(true);
    expect(Instant.parse("-271821-04-20T00:00:00Z").equals(MIN)).toBe(true);
  });

  test("reads the fields as a moment on the UTC timeline", () => {
    expect(parts(Instant.parse("2026-10-01T12:30:00.123456789Z"))).toEqual([Date.UTC(2026, 9, 1, 12, 30) / 1000, 123_456_789]);
    expect(parts(Instant.parse("1969-12-31T23:59:59.5Z"))).toEqual([-1, 500_000_000]);
  });

  test("pads a short fraction as a decimal of a second and normalises it on output", () => {
    expect(Instant.parse("2026-10-01T12:30:00.5Z").toString()).toBe("2026-10-01T12:30:00.500Z");
    expect(Instant.parse("2026-10-01T12:30:00.1234Z").toString()).toBe("2026-10-01T12:30:00.123400Z");
    expect(Instant.parse("2026-10-01T12:30:00.000Z").toString()).toBe("2026-10-01T12:30:00Z");
  });

  test("reads an expanded year inside 0000 to 9999 as the four-digit one", () => {
    expect(Instant.parse("+002026-10-01T12:30:00Z").toString()).toBe("2026-10-01T12:30:00Z");
    expect(Instant.parse("+000000-01-01T00:00:00Z").toString()).toBe("0000-01-01T00:00:00Z");
  });

  test.for([
    "2026-10-01T12:30:00",
    "2026-10-01T12:30:00z",
    "2026-10-01T12:30:00+00:00",
    "2026-10-01T12:30:00-05:00",
    "2026-10-01T12:30:00.1234567890Z",
    "2026-10-01T12:30:00.Z",
    "2026-10-01T12:30Z",
    "2026-10-01t12:30:00Z",
    "2026-10-01 12:30:00Z",
    " 2026-10-01T12:30:00Z",
    "2026-10-01T12:30:00Z ",
    "26-10-01T12:30:00Z",
    "20260-10-01T12:30:00Z",
    "+2026-10-01T12:30:00Z",
    "-000000-01-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2023-02-29T00:00:00Z",
    "2026-10-00T00:00:00Z",
    "2026-10-01T24:00:00Z",
    "2026-10-01T12:60:00Z",
    "2026-10-01T12:00:60Z",
    "+275760-09-13T00:00:00.000000001Z",
    "+275760-09-13T00:00:01Z",
    "-271821-04-19T23:59:59.999999999Z",
    "",
  ])("rejects %j with DateTimeParseError", (text) => {
    expect(() => Instant.parse(text)).toThrow(DateTimeParseError);
    expect(Instant.tryParse(text)).toEqual({ success: false });
  });

  test("throws an error the guard recognises", () => {
    try {
      Instant.parse("2026-10-01T12:30:00z");
      expect.unreachable("Instant.parse accepted a lower-case z");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
    }
  });

  test("tryParse returns the instant on success", () => {
    const result = Instant.tryParse("2026-10-01T12:30:00.250Z");

    expect(result.success).toBe(true);
    expect(result.value?.equals(Instant.ofEpochSecond(Date.UTC(2026, 9, 1, 12, 30) / 1000, 250_000_000))).toBe(true);
  });
});

describe("Instant#toString", () => {
  test.for([
    0,
    1,
    -1,
    999,
    -999,
    1_790_000_000_123,
    -62_135_596_800_000,
    253_402_300_799_999,
    MAX_MILLI,
    -MAX_MILLI,
    MAX_MILLI - 1,
    -MAX_MILLI + 1,
  ])("agrees with Date#toISOString at %s ms", (milli) => {
    expect(Instant.ofEpochMilli(milli).toString()).toBe(new Date(milli).toISOString().replace(".000Z", "Z"));
  });

  test("writes the shortest exact fraction of 3, 6 or 9 digits", () => {
    expect(Instant.ofEpochSecond(0, 120_000_000).toString()).toBe("1970-01-01T00:00:00.120Z");
    expect(Instant.ofEpochSecond(0, 123_400_000).toString()).toBe("1970-01-01T00:00:00.123400Z");
    expect(Instant.ofEpochSecond(0, 123_456_780).toString()).toBe("1970-01-01T00:00:00.123456780Z");
  });
});

describe("Instant#compare and Instant#equals", () => {
  test("compare returns -1, 0 or 1", () => {
    expect(Instant.compare(MIN, MAX)).toBe(-1);
    expect(Instant.compare(MAX, MIN)).toBe(1);
    expect(Instant.compare(Instant.ofEpochSecond(5, 1), Instant.ofEpochSecond(5, 2))).toBe(-1);
    expect(Instant.compare(Instant.ofEpochSecond(5, 999_999_999), Instant.ofEpochSecond(5, 0))).toBe(1);
    expect(Instant.compare(Instant.ofEpochMilli(-1), Instant.ofEpochSecond(-1, 999_000_000))).toBe(0);
  });

  test("orders the instants just before the epoch before it", () => {
    expect(Instant.compare(Instant.ofEpochSecond(-1, 999_999_999), Instant.ofEpochSecond(0))).toBe(-1);
  });
});

describe("plus and minus", () => {
  test("carry the nanosecond into the second across the second boundary", () => {
    expect(parts(Instant.ofEpochSecond(0, 999_999_999).plusNanos(1))).toEqual([1, 0]);
    expect(parts(Instant.ofEpochSecond(1).minusNanos(1))).toEqual([0, 999_999_999]);
    expect(parts(Instant.ofEpochSecond(0, 600_000_000).plusMillis(500))).toEqual([1, 100_000_000]);
    expect(parts(Instant.ofEpochSecond(1, 100_000_000).minusMillis(500))).toEqual([0, 600_000_000]);
  });

  test("carry the nanosecond into the second before the epoch", () => {
    expect(parts(Instant.ofEpochSecond(0).minusNanos(1))).toEqual([-1, 999_999_999]);
    expect(parts(Instant.ofEpochSecond(-1, 999_999_999).plusNanos(1))).toEqual([0, 0]);
    expect(parts(Instant.ofEpochSecond(-1, 500_000_000).plusMillis(700))).toEqual([0, 200_000_000]);
    expect(parts(Instant.ofEpochSecond(0).minusMillis(1500))).toEqual([-2, 500_000_000]);
    expect(parts(Instant.ofEpochSecond(0).plusNanos(-1_500_000_001))).toEqual([-2, 499_999_999]);
    expect(Instant.ofEpochSecond(0).minusNanos(1).toEpochMilli()).toBe(-1);
  });

  test("move by whole seconds", () => {
    expect(parts(Instant.ofEpochSecond(10, 5).plusSeconds(-20))).toEqual([-10, 5]);
    expect(parts(Instant.ofEpochSecond(10, 5).minusSeconds(20))).toEqual([-10, 5]);
    expect(MIN.plusSeconds(2 * MAX_SECOND).equals(MAX)).toBe(true);
  });

  test("stay exact for the largest safe amounts", () => {
    const epoch = Instant.ofEpochSecond(0);

    expect(parts(epoch.plusNanos(Number.MAX_SAFE_INTEGER))).toEqual([9_007_199, 254_740_991]);
    expect(parts(epoch.minusNanos(Number.MAX_SAFE_INTEGER))).toEqual([-9_007_200, 745_259_009]);
    expect(MIN.plusMillis(MAX_MILLI).equals(epoch)).toBe(true);
    expect(MAX.minusMillis(MAX_MILLI).equals(epoch)).toBe(true);
  });

  test("throw a RangeError when the result leaves the range", () => {
    expect(() => MAX.plusNanos(1)).toThrow(RangeError);
    expect(() => MIN.minusNanos(1)).toThrow(RangeError);
    expect(() => MAX.plusSeconds(1)).toThrow(RangeError);
    expect(() => MIN.minusSeconds(1)).toThrow(RangeError);
    expect(() => MAX.plusMillis(1)).toThrow(RangeError);
    expect(() => MIN.minusMillis(1)).toThrow(RangeError);
    expect(() => Instant.ofEpochSecond(MAX_SECOND - 1, 999_999_999).plusNanos(2)).toThrow(RangeError);
    expect(() => Instant.ofEpochSecond(0).plusMillis(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => Instant.ofEpochSecond(0).plusSeconds(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  test("reach the upper bound itself", () => {
    expect(
      Instant.ofEpochSecond(MAX_SECOND - 1, 999_999_999)
        .plusNanos(1)
        .equals(MAX),
    ).toBe(true);
  });

  test.for([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("reject the amount %s as a RangeError", (amount) => {
    const epoch = Instant.ofEpochSecond(0);

    expect(() => epoch.plusSeconds(amount)).toThrow(RangeError);
    expect(() => epoch.minusSeconds(amount)).toThrow(RangeError);
    expect(() => epoch.plusMillis(amount)).toThrow(RangeError);
    expect(() => epoch.minusMillis(amount)).toThrow(RangeError);
    expect(() => epoch.plusNanos(amount)).toThrow(RangeError);
    expect(() => epoch.minusNanos(amount)).toThrow(RangeError);
  });
});

describe("properties", () => {
  const INSTANTS = [
    MIN,
    Instant.ofEpochSecond(-MAX_SECOND, 1),
    Instant.ofEpochSecond(-MAX_SECOND + 86_399, 999_999_999),
    Instant.ofEpochSecond(-62_135_596_801, 999_999_999),
    Instant.ofEpochSecond(-86_401, 500),
    Instant.ofEpochSecond(-60, 999_999_999),
    Instant.ofEpochSecond(-1),
    Instant.ofEpochSecond(-1, 999_999_999),
    Instant.ofEpochSecond(0),
    Instant.ofEpochSecond(0, 1),
    Instant.ofEpochSecond(59, 999_999_999),
    Instant.ofEpochSecond(86_399, 999_999_999),
    Instant.ofEpochSecond(951_782_399, 123_000_000),
    Instant.ofEpochSecond(1_790_000_000, 123_456),
    Instant.ofEpochSecond(253_402_300_799, 999_999_999),
    Instant.ofEpochSecond(253_402_300_800),
    Instant.ofEpochSecond(MAX_SECOND - 1, 999_999_999),
    MAX,
  ];

  test.each(INSTANTS.map((instant) => [instant.toString(), instant] as const))("%s round-trips through ISO", (_text, instant) => {
    expect(Instant.parse(instant.toString()).equals(instant)).toBe(true);
    expect(Instant.parse(instant.toString()).toString()).toBe(instant.toString());
  });

  test.each(INSTANTS.map((instant) => [instant.toString(), instant] as const))(
    "%s reassembles from its epoch second and nanosecond",
    (_text, instant) => {
      expect(Instant.ofEpochSecond(instant.toEpochSecond(), instant.nanosecond).equals(instant)).toBe(true);
    },
  );

  const AMOUNTS = [
    0,
    1,
    999_999_999,
    1_000_000_000,
    1_000_000_001,
    59_999_999_999,
    60_000_000_000,
    3_600_000_000_001,
    86_399_999_999_999,
    86_400_000_000_000,
    86_400_000_000_001,
    3_153_600_012_345_678,
    Number.MAX_SAFE_INTEGER,
  ];
  const STARTS = INSTANTS.slice(3, -3);

  test.each(STARTS.map((instant) => [instant.toString(), instant] as const))(
    "plusNanos(n).minusNanos(n) is the identity from %s",
    (_text, start) => {
      for (const amount of AMOUNTS) {
        expect(start.plusNanos(amount).minusNanos(amount).equals(start)).toBe(true);
        expect(start.minusNanos(amount).plusNanos(amount).equals(start)).toBe(true);
      }
    },
  );

  test("compare agrees with equals", () => {
    for (const a of INSTANTS) {
      for (const b of INSTANTS) {
        const sameParts = a.toEpochSecond() === b.toEpochSecond() && a.nanosecond === b.nanosecond;
        expect(a.equals(b)).toBe(sameParts);
        expect(Instant.compare(a, b) === 0).toBe(a.equals(b));
        expect(Instant.compare(a, b) + Instant.compare(b, a)).toBe(0);
      }
    }
  });

  test("compare orders by the timeline", () => {
    for (let index = 1; index < INSTANTS.length; index++) {
      expect(Instant.compare(INSTANTS[index - 1] as Instant, INSTANTS[index] as Instant)).toBe(-1);
    }
  });
});

describe("Instant#atZone", () => {
  /** A value's local date-time, offset and instant as plain strings and numbers, for one `toEqual`. */
  function zonedParts(value: ZonedDateTime): { local: string; offsetSeconds: number; instant: string } {
    return { local: value.toLocalDateTime().toString(), offsetSeconds: value.offsetSeconds, instant: value.toInstant().toString() };
  }

  /** `Instant.parse(instant).atZone(ZoneId.of(zone))` as {@link zonedParts}. */
  function atZone(instant: string, zone: string): { local: string; offsetSeconds: number; instant: string } {
    return zonedParts(Instant.parse(instant).atZone(ZoneId.of(zone)));
  }

  test("reads the wall-clock time and offset the zone shows, keeping the nanosecond", () => {
    expect(atZone("2026-07-15T11:45:30.123456789Z", "Europe/Berlin")).toEqual({
      local: "2026-07-15T13:45:30.123456789",
      offsetSeconds: 7200,
      instant: "2026-07-15T11:45:30.123456789Z",
    });
  });

  test("holds the zone it was given", () => {
    const zone = ZoneId.of("Europe/Berlin");

    expect(Instant.parse("2026-07-15T11:45:30Z").atZone(zone).zone).toBe(zone);
  });

  test("floors an instant before the epoch onto the previous day's last second", () => {
    expect(atZone("1969-12-31T23:59:59.000000005Z", "UTC")).toEqual({
      local: "1969-12-31T23:59:59.000000005",
      offsetSeconds: 0,
      instant: "1969-12-31T23:59:59.000000005Z",
    });
  });

  test.for([
    ["Europe/Berlin", "2026-03-29T00:59:59.999999999Z", "2026-03-29T01:59:59.999999999", 3600],
    ["Europe/Berlin", "2026-03-29T01:00:00Z", "2026-03-29T03:00", 7200],
    ["America/New_York", "2026-03-08T06:59:59.999999999Z", "2026-03-08T01:59:59.999999999", -18_000],
    ["America/New_York", "2026-03-08T07:00:00Z", "2026-03-08T03:00", -14_400],
  ] as const)("in %s reads %s on its side of the spring-forward gap", ([zone, instant, local, offsetSeconds]) => {
    expect(atZone(instant, zone)).toEqual({ local, offsetSeconds, instant });
  });

  test.for([
    ["Europe/Berlin", "2026-10-25T00:30:00.500Z", "2026-10-25T02:30:00.500", 7200],
    ["Europe/Berlin", "2026-10-25T01:30:00.500Z", "2026-10-25T02:30:00.500", 3600],
    ["America/New_York", "2026-11-01T05:30:00.500Z", "2026-11-01T01:30:00.500", -14_400],
    ["America/New_York", "2026-11-01T06:30:00.500Z", "2026-11-01T01:30:00.500", -18_000],
  ] as const)(
    "in %s keeps %s's own offset on a wall-clock time the fall-back overlap reads twice",
    ([zone, instant, local, offsetSeconds]) => {
      expect(atZone(instant, zone)).toEqual({ local, offsetSeconds, instant });
    },
  );

  test("carries a local mean time offset's seconds into the wall-clock time", () => {
    expect(atZone("1880-06-01T11:06:32Z", "Europe/Berlin")).toEqual({
      local: "1880-06-01T12:00",
      offsetSeconds: 3208,
      instant: "1880-06-01T11:06:32Z",
    });
  });

  test("reads the last nanosecond of 9999-12-31 in the zone", () => {
    expect(atZone("9999-12-31T22:59:59.999999999Z", "Europe/Berlin").local).toBe("9999-12-31T23:59:59.999999999");
  });

  test.for([
    ["9999-12-31T23:00:00Z", "Europe/Berlin"],
    ["0001-01-01T00:00:00Z", "America/New_York"],
  ] as const)("throws InvalidDateTimeError when %s in %s falls outside years 1 to 9999", ([instant, zone]) => {
    let error: unknown;
    try {
      Instant.parse(instant).atZone(ZoneId.of(zone));
    } catch (caught) {
      error = caught;
    }
    expect(isInvalidDateTimeError(error)).toBe(true);
  });
});
