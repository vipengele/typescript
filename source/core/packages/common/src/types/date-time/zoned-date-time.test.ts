import { describe, expect, test } from "vitest";
import { isDateTimeParseError, isInvalidDateTimeError, isUnknownZoneError, isZoneResolutionError } from "./errors";
import { LocalDateTime } from "./local-date-time";
import type { Disambiguation } from "./zone-resolve";
import { ZoneId } from "./zone-id";
import { ZonedDateTime } from "./zoned-date-time";

/** `ZonedDateTime.of` over a parsed local date-time and zone name. */
function zoned(local: string, zone: string, disambiguation?: Disambiguation): ZonedDateTime {
  return ZonedDateTime.of(LocalDateTime.parse(local), ZoneId.of(zone), { disambiguation });
}

/** A value's local date-time, zone, offset and instant as plain strings and numbers, for one `toEqual`. */
function parts(value: ZonedDateTime): { local: string; zone: string; offsetSeconds: number; instant: string } {
  return {
    local: value.toLocalDateTime().toString(),
    zone: value.zone.id,
    offsetSeconds: value.offsetSeconds,
    instant: value.toInstant().toString(),
  };
}

/** The error `fn` throws, or `undefined` when it returns. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("ZonedDateTime.of on a time the zone reads once", () => {
  test.for(["compatible", "earlier", "later", "reject"] as const)("%s keeps the time and takes its one offset", (mode) => {
    expect(parts(zoned("2026-07-15T13:45:30.123456789", "Europe/Berlin", mode))).toEqual({
      local: "2026-07-15T13:45:30.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-07-15T11:45:30.123456789Z",
    });
  });

  test("returns the LocalDateTime it was given from toLocalDateTime", () => {
    const local = LocalDateTime.parse("2026-01-15T08:00");

    expect(ZonedDateTime.of(local, ZoneId.of("America/New_York")).toLocalDateTime()).toBe(local);
  });

  test("holds the zone it was given", () => {
    const zone = ZoneId.of("America/New_York");

    expect(ZonedDateTime.of(LocalDateTime.parse("2026-01-15T08:00"), zone).zone).toBe(zone);
  });

  test("reads a west-of-Greenwich offset as negative", () => {
    expect(parts(zoned("2026-01-15T08:00", "America/New_York"))).toEqual({
      local: "2026-01-15T08:00",
      zone: "America/New_York",
      offsetSeconds: -18_000,
      instant: "2026-01-15T13:00:00Z",
    });
  });

  test("carries a local mean time offset's seconds into the offset and the instant", () => {
    expect(parts(zoned("1880-06-01T12:00", "Europe/Berlin"))).toEqual({
      local: "1880-06-01T12:00",
      zone: "Europe/Berlin",
      offsetSeconds: 3208,
      instant: "1880-06-01T11:06:32Z",
    });
  });
});

describe("ZonedDateTime.of in a gap", () => {
  const local = "2026-03-29T02:30:15.123456789";

  test("compatible is the default and moves forward to the offset after", () => {
    const value = ZonedDateTime.of(LocalDateTime.parse(local), ZoneId.of("Europe/Berlin"));

    expect(parts(value)).toEqual({
      local: "2026-03-29T03:30:15.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T01:30:15.123456789Z",
    });
  });

  test("compatible moves forward to the offset after", () => {
    expect(parts(zoned(local, "Europe/Berlin", "compatible"))).toEqual({
      local: "2026-03-29T03:30:15.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T01:30:15.123456789Z",
    });
  });

  test("later moves forward to the offset after", () => {
    expect(parts(zoned(local, "Europe/Berlin", "later"))).toEqual({
      local: "2026-03-29T03:30:15.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T01:30:15.123456789Z",
    });
  });

  test("earlier moves back to the offset before", () => {
    expect(parts(zoned(local, "Europe/Berlin", "earlier"))).toEqual({
      local: "2026-03-29T01:30:15.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-03-29T00:30:15.123456789Z",
    });
  });

  test("reject throws a ZoneResolutionError", () => {
    const error = thrown(() => zoned("2026-03-08T02:30", "America/New_York", "reject"));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-03-08T02:30 does not exist in America/New_York.");
  });
});

describe("ZonedDateTime.of in an overlap", () => {
  const local = "2026-11-01T01:30:00.000000001";

  test("compatible is the default and takes the earlier instant", () => {
    const value = ZonedDateTime.of(LocalDateTime.parse(local), ZoneId.of("America/New_York"));

    expect(parts(value)).toEqual({
      local: "2026-11-01T01:30:00.000000001",
      zone: "America/New_York",
      offsetSeconds: -14_400,
      instant: "2026-11-01T05:30:00.000000001Z",
    });
  });

  test("compatible takes the earlier instant", () => {
    expect(zoned(local, "America/New_York", "compatible").offsetSeconds).toBe(-14_400);
  });

  test("earlier takes the earlier instant", () => {
    expect(parts(zoned(local, "America/New_York", "earlier"))).toEqual({
      local: "2026-11-01T01:30:00.000000001",
      zone: "America/New_York",
      offsetSeconds: -14_400,
      instant: "2026-11-01T05:30:00.000000001Z",
    });
  });

  test("later takes the later instant", () => {
    expect(parts(zoned(local, "America/New_York", "later"))).toEqual({
      local: "2026-11-01T01:30:00.000000001",
      zone: "America/New_York",
      offsetSeconds: -18_000,
      instant: "2026-11-01T06:30:00.000000001Z",
    });
  });

  test("reject throws a ZoneResolutionError", () => {
    const error = thrown(() => zoned("2026-10-25T02:30", "Europe/Berlin", "reject"));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-10-25T02:30 is ambiguous in Europe/Berlin.");
  });
});

describe("ZonedDateTime values", () => {
  test("are frozen", () => {
    expect(Object.isFrozen(zoned("2026-07-15T12:00", "Europe/Berlin"))).toBe(true);
  });
});

describe("ZonedDateTime#toInstant", () => {
  test.for([
    { name: "Berlin in summer", zone: "Europe/Berlin", local: "2026-07-15T13:45:30.123456789", instant: "2026-07-15T11:45:30.123456789Z" },
    {
      name: "New York in winter",
      zone: "America/New_York",
      local: "2026-12-31T23:59:59.999999999",
      instant: "2027-01-01T04:59:59.999999999Z",
    },
    { name: "Kolkata, a half-hour offset", zone: "Asia/Kolkata", local: "2026-02-03T04:05:06.7", instant: "2026-02-02T22:35:06.700Z" },
    { name: "Berlin's local mean time in year 1", zone: "Europe/Berlin", local: "0001-01-01T00:00", instant: "0000-12-31T23:06:32Z" },
    {
      name: "New York's local mean time in year 1",
      zone: "America/New_York",
      local: "0001-01-01T00:00:01",
      instant: "0001-01-01T04:56:03Z",
    },
    {
      name: "Kiritimati at the last nanosecond of 9999",
      zone: "Pacific/Kiritimati",
      local: "9999-12-31T23:59:59.999999999",
      instant: "9999-12-31T09:59:59.999999999Z",
    },
  ])("is the local date-time read as UTC less the offset, to the nanosecond: $name", ({ zone, local, instant }) => {
    expect(zoned(local, zone).toInstant().toString()).toBe(instant);
  });

  test.for([
    { zone: "Europe/Berlin", local: "2026-07-15T13:45:30.123456789" },
    { zone: "America/New_York", local: "2026-12-31T23:59:59.999999999" },
    { zone: "Europe/Berlin", local: "0001-01-01T00:00" },
    { zone: "Pacific/Kiritimati", local: "9999-12-31T23:59:59.999999999" },
  ])("reads back in the zone as the same local date-time: $zone $local", ({ zone, local }) => {
    const value = zoned(local, zone);
    const instant = value.toInstant();
    const offset = value.zone.offsetSecondsAt(instant);
    const wallClock = LocalDateTime.parse(instant.plusSeconds(offset).toString().slice(0, -1));

    expect(offset).toBe(value.offsetSeconds);
    expect(wallClock.equals(value.toLocalDateTime())).toBe(true);
  });
});

describe("ZonedDateTime.compare", () => {
  test("orders by instant, whatever the zones", () => {
    const berlin = zoned("2026-07-15T14:00", "Europe/Berlin");
    const newYork = zoned("2026-07-15T08:00:00.000000001", "America/New_York");

    expect(ZonedDateTime.compare(berlin, newYork)).toBe(-1);
    expect(ZonedDateTime.compare(newYork, berlin)).toBe(1);
  });

  test("orders by the nanosecond within a second", () => {
    const a = zoned("2026-07-15T12:00:00.000000001", "Europe/Berlin");
    const b = zoned("2026-07-15T12:00:00.000000002", "Europe/Berlin");

    expect(ZonedDateTime.compare(a, b)).toBe(-1);
    expect(ZonedDateTime.compare(b, a)).toBe(1);
  });

  test("is 0 for the same instant in two zones", () => {
    const berlin = zoned("2026-07-15T14:00:00.5", "Europe/Berlin");
    const newYork = zoned("2026-07-15T08:00:00.5", "America/New_York");

    expect(ZonedDateTime.compare(berlin, newYork)).toBe(0);
  });

  test("orders the two readings of a time in an overlap by instant", () => {
    const first = zoned("2026-10-25T02:30", "Europe/Berlin", "earlier");
    const second = zoned("2026-10-25T02:30", "Europe/Berlin", "later");

    expect(ZonedDateTime.compare(first, second)).toBe(-1);
  });
});

describe("ZonedDateTime equality", () => {
  test("is true for the same instant in the same zone", () => {
    expect(zoned("2026-07-15T14:00:00.5", "Europe/Berlin").equals(zoned("2026-07-15T14:00:00.5", "Europe/Berlin"))).toBe(true);
  });

  test("is false for the same instant in another zone", () => {
    expect(zoned("2026-07-15T14:00", "Europe/Berlin").equals(zoned("2026-07-15T08:00", "America/New_York"))).toBe(false);
  });

  test("is false for another instant in the same zone", () => {
    expect(zoned("2026-07-15T14:00", "Europe/Berlin").equals(zoned("2026-07-15T14:00:00.000000001", "Europe/Berlin"))).toBe(false);
  });

  test("is false for the two readings of a time in an overlap", () => {
    expect(zoned("2026-10-25T02:30", "Europe/Berlin", "earlier").equals(zoned("2026-10-25T02:30", "Europe/Berlin", "later"))).toBe(false);
  });
});

/** Elapsed seconds from `from`'s instant to `to`'s. */
function elapsedSeconds(from: ZonedDateTime, to: ZonedDateTime): number {
  return to.toInstant().toEpochSecond() - from.toInstant().toEpochSecond();
}

describe("ZonedDateTime adding days", () => {
  test("keeps the wall-clock time across a spring-forward, 23 elapsed hours", () => {
    const start = zoned("2026-03-28T12:00", "Europe/Berlin");
    const next = start.plusDays(1);

    expect(parts(next)).toEqual({
      local: "2026-03-29T12:00",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T10:00:00Z",
    });
    expect(elapsedSeconds(start, next)).toBe(23 * 3600);
  });

  test("keeps the wall-clock time across a fall-back, 25 elapsed hours", () => {
    const start = zoned("2026-10-24T12:00", "Europe/Berlin");
    const next = start.plusDays(1);

    expect(parts(next)).toEqual({
      local: "2026-10-25T12:00",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-10-25T11:00:00Z",
    });
    expect(elapsedSeconds(start, next)).toBe(25 * 3600);
  });

  test("goes back for a negative amount", () => {
    expect(zoned("2026-07-15T08:00", "America/New_York").plusDays(-15).toLocalDateTime().toString()).toBe("2026-06-30T08:00");
  });

  test("starts from the shifted time a value built in a gap holds", () => {
    const value = zoned("2026-03-29T02:30", "Europe/Berlin");

    expect(parts(value.plusDays(1))).toEqual({
      local: "2026-03-30T03:30",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-30T01:30:00Z",
    });
  });

  test("keeps the zone", () => {
    const zone = ZoneId.of("Asia/Kolkata");

    expect(ZonedDateTime.of(LocalDateTime.parse("2026-02-03T04:05"), zone).plusDays(3).zone).toBe(zone);
  });
});

describe("ZonedDateTime subtracting days", () => {
  test("keeps the wall-clock time back across a spring-forward, 23 elapsed hours", () => {
    const start = zoned("2026-03-29T12:00", "Europe/Berlin");
    const previous = start.minusDays(1);

    expect(parts(previous)).toEqual({
      local: "2026-03-28T12:00",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-03-28T11:00:00Z",
    });
    expect(elapsedSeconds(previous, start)).toBe(23 * 3600);
  });

  test("undoes plusDays when neither end falls in a gap or an overlap", () => {
    const start = zoned("2026-10-24T12:00:00.5", "Europe/Berlin");

    expect(start.plusDays(1).minusDays(1).equals(start)).toBe(true);
  });

  test("does not undo plusDays from a time whose next day falls in a gap", () => {
    const start = zoned("2026-03-28T02:30", "Europe/Berlin");
    const back = start.plusDays(1).minusDays(1);

    expect(back.toLocalDateTime().toString()).toBe("2026-03-28T03:30");
    expect(elapsedSeconds(start, back)).toBe(3600);
  });

  test("does not undo plusDays from the later reading of a time in an overlap", () => {
    const start = zoned("2026-10-25T02:30", "Europe/Berlin", "later");
    const back = start.plusDays(1).minusDays(1);

    expect(back.toLocalDateTime().equals(start.toLocalDateTime())).toBe(true);
    expect(back.offsetSeconds).toBe(7200);
    expect(elapsedSeconds(start, back)).toBe(-3600);
  });
});

describe("ZonedDateTime adding months", () => {
  test("clamps January 31 to the last day of February", () => {
    expect(parts(zoned("2026-01-31T09:15", "Europe/Berlin").plusMonths(1))).toEqual({
      local: "2026-02-28T09:15",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-02-28T08:15:00Z",
    });
  });

  test("clamps January 31 to February 29 in a leap year", () => {
    expect(zoned("2028-01-31T09:15", "America/New_York").plusMonths(1).toLocalDateTime().toString()).toBe("2028-02-29T09:15");
  });

  test("keeps the wall-clock time across a transition and takes the new offset", () => {
    const start = zoned("2026-03-15T12:00", "Europe/Berlin");
    const next = start.plusMonths(1);

    expect(parts(next)).toEqual({
      local: "2026-04-15T12:00",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-04-15T10:00:00Z",
    });
    expect(elapsedSeconds(start, next)).toBe(31 * 86_400 - 3600);
  });
});

describe("ZonedDateTime subtracting months", () => {
  test("clamps the day to the end of the earlier month", () => {
    expect(parts(zoned("2026-03-31T09:15", "Europe/Berlin").minusMonths(1))).toEqual({
      local: "2026-02-28T09:15",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-02-28T08:15:00Z",
    });
  });

  test("does not undo a plusMonths that clamped the day", () => {
    expect(zoned("2026-01-31T09:15", "Europe/Berlin").plusMonths(1).minusMonths(1).toLocalDateTime().toString()).toBe("2026-01-28T09:15");
  });
});

describe("ZonedDateTime date arithmetic landing in a gap", () => {
  const start = "2026-03-28T02:30:15.123456789";

  test("compatible is the default and moves forward to the offset after", () => {
    expect(parts(zoned(start, "Europe/Berlin").plusDays(1))).toEqual({
      local: "2026-03-29T03:30:15.123456789",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T01:30:15.123456789Z",
    });
  });

  test.for([
    { mode: "compatible", local: "2026-03-29T03:30:15.123456789", offsetSeconds: 7200 },
    { mode: "later", local: "2026-03-29T03:30:15.123456789", offsetSeconds: 7200 },
    { mode: "earlier", local: "2026-03-29T01:30:15.123456789", offsetSeconds: 3600 },
  ] as const)("$mode settles the result as ZonedDateTime.of does", ({ mode, local, offsetSeconds }) => {
    const value = zoned(start, "Europe/Berlin").plusDays(1, { disambiguation: mode });

    expect(value.toLocalDateTime().toString()).toBe(local);
    expect(value.offsetSeconds).toBe(offsetSeconds);
  });

  test("reject throws a ZoneResolutionError from plusDays", () => {
    const error = thrown(() => zoned("2026-03-28T02:30", "Europe/Berlin").plusDays(1, { disambiguation: "reject" }));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-03-29T02:30 does not exist in Europe/Berlin.");
  });

  test("reject throws a ZoneResolutionError from minusMonths", () => {
    const error = thrown(() => zoned("2026-04-29T02:30", "Europe/Berlin").minusMonths(1, { disambiguation: "reject" }));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-03-29T02:30 does not exist in Europe/Berlin.");
  });
});

describe("ZonedDateTime date arithmetic landing in an overlap", () => {
  const start = "2026-10-24T02:30";

  test("compatible is the default and takes the earlier instant", () => {
    expect(parts(zoned(start, "Europe/Berlin").plusDays(1))).toEqual({
      local: "2026-10-25T02:30",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-10-25T00:30:00Z",
    });
  });

  test.for([
    { mode: "compatible", offsetSeconds: 7200 },
    { mode: "earlier", offsetSeconds: 7200 },
    { mode: "later", offsetSeconds: 3600 },
  ] as const)("$mode settles the result as ZonedDateTime.of does", ({ mode, offsetSeconds }) => {
    const value = zoned(start, "Europe/Berlin").plusDays(1, { disambiguation: mode });

    expect(value.toLocalDateTime().toString()).toBe("2026-10-25T02:30");
    expect(value.offsetSeconds).toBe(offsetSeconds);
  });

  test("reject throws a ZoneResolutionError from plusDays", () => {
    const error = thrown(() => zoned(start, "Europe/Berlin").plusDays(1, { disambiguation: "reject" }));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-10-25T02:30 is ambiguous in Europe/Berlin.");
  });

  test("reject throws a ZoneResolutionError from minusDays", () => {
    const error = thrown(() => zoned("2026-10-26T02:30", "Europe/Berlin").minusDays(1, { disambiguation: "reject" }));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-10-25T02:30 is ambiguous in Europe/Berlin.");
  });

  test("reject throws a ZoneResolutionError from plusMonths", () => {
    const error = thrown(() => zoned("2026-09-25T02:30", "Europe/Berlin").plusMonths(1, { disambiguation: "reject" }));

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe("The local date-time 2026-10-25T02:30 is ambiguous in Europe/Berlin.");
  });
});

describe("ZonedDateTime time arithmetic", () => {
  test("plusHours(24) is 24 elapsed hours across a spring-forward, moving the wall clock an hour further", () => {
    const start = zoned("2026-03-28T12:00", "Europe/Berlin");
    const next = start.plusHours(24);

    expect(parts(next)).toEqual({
      local: "2026-03-29T13:00",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-03-29T11:00:00Z",
    });
    expect(elapsedSeconds(start, next)).toBe(24 * 3600);
  });

  test("plusHours(24) is 24 elapsed hours across a fall-back, moving the wall clock an hour less", () => {
    const start = zoned("2026-10-24T12:00", "Europe/Berlin");
    const next = start.plusHours(24);

    expect(parts(next)).toEqual({
      local: "2026-10-25T11:00",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-10-25T10:00:00Z",
    });
    expect(elapsedSeconds(start, next)).toBe(24 * 3600);
  });

  test.for([
    { name: "one hour", start: "2026-03-29T01:30", step: (v: ZonedDateTime) => v.plusHours(1), local: "2026-03-29T03:30" },
    { name: "thirty minutes", start: "2026-03-29T01:45", step: (v: ZonedDateTime) => v.plusMinutes(30), local: "2026-03-29T03:15" },
    { name: "one second", start: "2026-03-29T01:59:59", step: (v: ZonedDateTime) => v.plusSeconds(1), local: "2026-03-29T03:00" },
    {
      name: "one nanosecond",
      start: "2026-03-29T01:59:59.999999999",
      step: (v: ZonedDateTime) => v.plusNanos(1),
      local: "2026-03-29T03:00",
    },
  ])("adding $name jumps the wall clock over a gap", ({ start, step, local }) => {
    const value = step(zoned(start, "Europe/Berlin"));

    expect(value.toLocalDateTime().toString()).toBe(local);
    expect(value.offsetSeconds).toBe(7200);
  });

  test("plusHours(1) from the earlier reading of a time in an overlap reaches its later reading", () => {
    const value = zoned("2026-10-25T02:30", "Europe/Berlin", "earlier").plusHours(1);

    expect(parts(value)).toEqual({
      local: "2026-10-25T02:30",
      zone: "Europe/Berlin",
      offsetSeconds: 3600,
      instant: "2026-10-25T01:30:00Z",
    });
  });

  test.for([
    { name: "one hour", step: (v: ZonedDateTime) => v.minusHours(1), instant: "2026-03-29T00:30:00Z" },
    { name: "sixty minutes", step: (v: ZonedDateTime) => v.minusMinutes(60), instant: "2026-03-29T00:30:00Z" },
    { name: "3600 seconds", step: (v: ZonedDateTime) => v.minusSeconds(3600), instant: "2026-03-29T00:30:00Z" },
    { name: "one nanosecond", step: (v: ZonedDateTime) => v.minusNanos(1), instant: "2026-03-29T01:29:59.999999999Z" },
  ])("subtracting $name goes back over a gap by elapsed time", ({ step, instant }) => {
    const value = step(zoned("2026-03-29T03:30", "Europe/Berlin"));

    expect(value.toInstant().toString()).toBe(instant);
    expect(value.zone.id).toBe("Europe/Berlin");
  });

  test.for([
    { name: "hours", there: (v: ZonedDateTime) => v.plusHours(7), back: (v: ZonedDateTime) => v.minusHours(7) },
    { name: "minutes", there: (v: ZonedDateTime) => v.plusMinutes(-500), back: (v: ZonedDateTime) => v.minusMinutes(-500) },
    { name: "seconds", there: (v: ZonedDateTime) => v.plusSeconds(12_345), back: (v: ZonedDateTime) => v.minusSeconds(12_345) },
    {
      name: "nanos",
      there: (v: ZonedDateTime) => v.plusNanos(3_600_000_000_001),
      back: (v: ZonedDateTime) => v.minusNanos(3_600_000_000_001),
    },
  ])("minus undoes plus across a transition: $name", ({ there, back }) => {
    const start = zoned("2026-10-25T02:30:00.25", "Europe/Berlin", "later");

    expect(back(there(start)).equals(start)).toBe(true);
    expect(back(there(start)).offsetSeconds).toBe(3600);
  });

  test("keeps the zone", () => {
    const zone = ZoneId.of("America/New_York");

    expect(ZonedDateTime.of(LocalDateTime.parse("2026-01-15T08:00"), zone).plusMinutes(5).zone).toBe(zone);
  });
});

describe("ZonedDateTime arithmetic and the nanosecond", () => {
  const start = "2026-07-15T13:45:30.123456789";

  test.for([
    { name: "plusDays", step: (v: ZonedDateTime) => v.plusDays(1), local: "2026-07-16T13:45:30.123456789" },
    { name: "minusDays", step: (v: ZonedDateTime) => v.minusDays(1), local: "2026-07-14T13:45:30.123456789" },
    { name: "plusMonths", step: (v: ZonedDateTime) => v.plusMonths(1), local: "2026-08-15T13:45:30.123456789" },
    { name: "minusMonths", step: (v: ZonedDateTime) => v.minusMonths(1), local: "2026-06-15T13:45:30.123456789" },
    { name: "plusHours", step: (v: ZonedDateTime) => v.plusHours(1), local: "2026-07-15T14:45:30.123456789" },
    { name: "plusMinutes", step: (v: ZonedDateTime) => v.plusMinutes(1), local: "2026-07-15T13:46:30.123456789" },
    { name: "plusSeconds", step: (v: ZonedDateTime) => v.plusSeconds(1), local: "2026-07-15T13:45:31.123456789" },
  ])("$name keeps it", ({ step, local }) => {
    expect(step(zoned(start, "Europe/Berlin")).toLocalDateTime().toString()).toBe(local);
  });

  test("plusNanos carries past the end of a day into the next", () => {
    expect(zoned("2026-12-31T23:59:59.999999999", "America/New_York").plusNanos(1).toLocalDateTime().toString()).toBe("2027-01-01T00:00");
  });

  test("minusNanos borrows back past the start of a day", () => {
    expect(zoned("2027-01-01T00:00", "America/New_York").minusNanos(1).toLocalDateTime().toString()).toBe("2026-12-31T23:59:59.999999999");
  });
});

describe("ZonedDateTime arithmetic amounts", () => {
  const value = zoned("2026-07-15T12:00", "Europe/Berlin");
  const methods = [
    "plusDays",
    "minusDays",
    "plusMonths",
    "minusMonths",
    "plusHours",
    "minusHours",
    "plusMinutes",
    "minusMinutes",
    "plusSeconds",
    "minusSeconds",
    "plusNanos",
    "minusNanos",
  ] as const;

  test.for(methods.flatMap((method) => [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53].map((amount) => ({ method, amount }))))(
    "$method refuses $amount, which is not a safe integer",
    ({ method, amount }) => {
      expect(() => value[method](amount)).toThrow(RangeError);
      expect(() => value[method](amount)).toThrow(/^The amount must be a safe integer, got /);
    },
  );

  test("plusHours names the amount it was given", () => {
    expect(() => value.plusHours(1.5)).toThrow("The amount must be a safe integer, got 1.5.");
  });

  test.for(methods)("%s takes zero as no change", (method) => {
    expect(value[method](0).equals(value)).toBe(true);
  });
});

describe("ZonedDateTime arithmetic past its range", () => {
  const value = zoned("2026-07-15T12:00", "Europe/Berlin");

  test.for([
    { name: "plusSeconds", step: (v: ZonedDateTime) => v.plusSeconds(Number.MAX_SAFE_INTEGER) },
    { name: "minusSeconds", step: (v: ZonedDateTime) => v.minusSeconds(Number.MAX_SAFE_INTEGER) },
    { name: "plusHours past the instant range", step: (v: ZonedDateTime) => v.plusHours(10_000_000_000) },
    { name: "plusHours past the safe integers", step: (v: ZonedDateTime) => v.plusHours(Number.MAX_SAFE_INTEGER) },
    { name: "minusHours past the safe integers", step: (v: ZonedDateTime) => v.minusHours(Number.MAX_SAFE_INTEGER) },
    { name: "plusMinutes past the safe integers", step: (v: ZonedDateTime) => v.plusMinutes(Number.MAX_SAFE_INTEGER) },
    { name: "minusMinutes past the safe integers", step: (v: ZonedDateTime) => v.minusMinutes(Number.MAX_SAFE_INTEGER) },
  ])("$name throws the instant's RangeError", ({ step }) => {
    expect(() => step(value)).toThrow(RangeError);
    expect(() => step(value)).toThrow(/^An instant must lie within ±8640000000000 seconds of the epoch/);
  });

  test.for([
    { name: "plusHours after 9999-12-31", start: "9999-12-31T23:30", step: (v: ZonedDateTime) => v.plusHours(1) },
    { name: "minusMinutes before 0001-01-01", start: "0001-01-01T00:10", step: (v: ZonedDateTime) => v.minusMinutes(20) },
    { name: "plusDays after 9999-12-31", start: "9999-12-31T12:00", step: (v: ZonedDateTime) => v.plusDays(1) },
    { name: "minusMonths before 0001-01-01", start: "0001-01-15T12:00", step: (v: ZonedDateTime) => v.minusMonths(1) },
  ])("$name throws an InvalidDateTimeError", ({ start, step }) => {
    expect(isInvalidDateTimeError(thrown(() => step(zoned(start, "Europe/Berlin"))))).toBe(true);
  });
});

describe("ZonedDateTime#toString", () => {
  test.for([
    { name: "Berlin in summer", local: "2026-10-01T14:30", zone: "Europe/Berlin", text: "2026-10-01T14:30+02:00[Europe/Berlin]" },
    { name: "Berlin in winter", local: "2026-01-15T08:00", zone: "Europe/Berlin", text: "2026-01-15T08:00+01:00[Europe/Berlin]" },
    {
      name: "New York, west of Greenwich",
      local: "2026-01-15T08:00",
      zone: "America/New_York",
      text: "2026-01-15T08:00-05:00[America/New_York]",
    },
    { name: "Tehran, a half-hour offset", local: "2026-02-03T04:05", zone: "Asia/Tehran", text: "2026-02-03T04:05+03:30[Asia/Tehran]" },
    {
      name: "a nanosecond fraction",
      local: "2026-07-15T13:45:30.123456789",
      zone: "Europe/Berlin",
      text: "2026-07-15T13:45:30.123456789+02:00[Europe/Berlin]",
    },
    {
      name: "a millisecond fraction",
      local: "2026-07-15T13:45:30.5",
      zone: "Europe/Berlin",
      text: "2026-07-15T13:45:30.500+02:00[Europe/Berlin]",
    },
    { name: "whole seconds", local: "2026-07-15T13:45:30", zone: "Europe/Berlin", text: "2026-07-15T13:45:30+02:00[Europe/Berlin]" },
    {
      name: "Berlin's local mean time",
      local: "1880-06-01T12:00",
      zone: "Europe/Berlin",
      text: "1880-06-01T12:00+00:53:28[Europe/Berlin]",
    },
    {
      name: "New York's local mean time",
      local: "1880-06-01T12:00",
      zone: "America/New_York",
      text: "1880-06-01T12:00-04:56:02[America/New_York]",
    },
  ])("writes the local date-time, the offset and the zone: $name", ({ local, zone, text }) => {
    expect(zoned(local, zone).toString()).toBe(text);
  });

  test("writes a zero offset as +00:00 in UTC, never Z", () => {
    const value = zoned("2026-07-15T12:00", "UTC");

    expect(value.toString()).toBe(`2026-07-15T12:00+00:00[${value.zone.id}]`);
    expect(value.toString()).toMatch(/^2026-07-15T12:00\+00:00\[(?:Etc\/)?UTC\]$/);
  });

  test("writes a zero offset as +00:00 in a zone that reads at UTC", () => {
    expect(zoned("2026-01-15T12:00", "Europe/London").toString()).toBe("2026-01-15T12:00+00:00[Europe/London]");
  });

  test("writes each reading of a time in an overlap with its own offset", () => {
    expect(zoned("2026-10-25T02:30", "Europe/Berlin", "earlier").toString()).toBe("2026-10-25T02:30+02:00[Europe/Berlin]");
    expect(zoned("2026-10-25T02:30", "Europe/Berlin", "later").toString()).toBe("2026-10-25T02:30+01:00[Europe/Berlin]");
  });

  test("writes the shifted time a value built in a gap holds", () => {
    expect(zoned("2026-03-29T02:30", "Europe/Berlin").toString()).toBe("2026-03-29T03:30+02:00[Europe/Berlin]");
  });
});

describe("ZonedDateTime.parse", () => {
  test("reads the local date-time, the offset and the zone", () => {
    expect(parts(ZonedDateTime.parse("2026-10-01T14:30+02:00[Europe/Berlin]"))).toEqual({
      local: "2026-10-01T14:30",
      zone: "Europe/Berlin",
      offsetSeconds: 7200,
      instant: "2026-10-01T12:30:00Z",
    });
  });

  test("reads a negative offset", () => {
    expect(parts(ZonedDateTime.parse("2026-01-15T08:00-05:00[America/New_York]"))).toEqual({
      local: "2026-01-15T08:00",
      zone: "America/New_York",
      offsetSeconds: -18_000,
      instant: "2026-01-15T13:00:00Z",
    });
  });

  test("reads the zone name as ZoneId.of does, case-insensitively and canonically", () => {
    expect(ZonedDateTime.parse("2026-10-01T14:30+02:00[europe/berlin]").zone.id).toBe("Europe/Berlin");
  });

  test("reads an offset written with zero seconds", () => {
    expect(ZonedDateTime.parse("2026-10-01T14:30+02:00:00[Europe/Berlin]").offsetSeconds).toBe(7200);
  });

  test.for([
    { name: "Berlin in summer, to the nanosecond", text: "2026-07-15T13:45:30.123456789+02:00[Europe/Berlin]" },
    { name: "New York in winter", text: "2026-12-31T23:59:59.999999999-05:00[America/New_York]" },
    { name: "Tehran", text: "2026-02-03T04:05:06.700+03:30[Asia/Tehran]" },
    { name: "the last nanosecond before Berlin's spring-forward gap", text: "2026-03-29T01:59:59.999999999+01:00[Europe/Berlin]" },
    { name: "the first moment after Berlin's spring-forward gap", text: "2026-03-29T03:00+02:00[Europe/Berlin]" },
    { name: "the earlier reading of a time in Berlin's overlap", text: "2026-10-25T02:30+02:00[Europe/Berlin]" },
    { name: "the later reading of a time in Berlin's overlap", text: "2026-10-25T02:30+01:00[Europe/Berlin]" },
    { name: "the earlier reading of a time in New York's overlap", text: "2026-11-01T01:30:00.000000001-04:00[America/New_York]" },
    { name: "the later reading of a time in New York's overlap", text: "2026-11-01T01:30:00.000000001-05:00[America/New_York]" },
    { name: "Berlin's local mean time, with offset seconds", text: "1880-06-01T12:00+00:53:28[Europe/Berlin]" },
    { name: "New York's local mean time, with negative offset seconds", text: "1880-06-01T12:00-04:56:02[America/New_York]" },
  ])("reads back what toString writes: $name", ({ text }) => {
    expect(ZonedDateTime.parse(text).toString()).toBe(text);
  });

  test("reads the two readings of a time in an overlap as two instants an hour apart", () => {
    const first = ZonedDateTime.parse("2026-10-25T02:30+02:00[Europe/Berlin]");
    const second = ZonedDateTime.parse("2026-10-25T02:30+01:00[Europe/Berlin]");

    expect(first.toInstant().toString()).toBe("2026-10-25T00:30:00Z");
    expect(second.toInstant().toString()).toBe("2026-10-25T01:30:00Z");
  });

  test.for([
    { name: "Berlin's earlier overlap reading", local: "2026-10-25T02:30", zone: "Europe/Berlin", mode: "earlier" },
    { name: "Berlin's later overlap reading", local: "2026-10-25T02:30", zone: "Europe/Berlin", mode: "later" },
    { name: "a value built in a gap", local: "2026-03-29T02:30:15.25", zone: "Europe/Berlin", mode: "compatible" },
    { name: "a local mean time", local: "0001-01-01T00:00", zone: "Europe/Berlin", mode: "compatible" },
    { name: "the last nanosecond of 9999", local: "9999-12-31T23:59:59.999999999", zone: "Pacific/Kiritimati", mode: "compatible" },
  ] as const)("gives a value equal to the one toString wrote: $name", ({ local, zone, mode }) => {
    const value = zoned(local, zone, mode);
    const read = ZonedDateTime.parse(value.toString());

    expect(read.equals(value)).toBe(true);
    expect(parts(read)).toEqual(parts(value));
  });

  test("gives a frozen value", () => {
    expect(Object.isFrozen(ZonedDateTime.parse("2026-10-01T14:30+02:00[Europe/Berlin]"))).toBe(true);
  });
});

describe("ZonedDateTime.parse refusing a string", () => {
  test.for([
    { name: "an empty string", text: "" },
    { name: "prose", text: "next Tuesday" },
    { name: "a local date-time alone", text: "2026-07-15T12:00" },
    { name: "an offset and no zone", text: "2026-07-15T12:00+02:00" },
    { name: "a zone and no offset", text: "2026-07-15T12:00[Europe/Berlin]" },
    { name: "Z in place of the offset", text: "2026-07-15T10:00Z[Europe/Berlin]" },
    { name: "an offset with a one-digit hour", text: "2026-07-15T12:00+2:00[Europe/Berlin]" },
    { name: "an offset with no colon", text: "2026-07-15T12:00+0200[Europe/Berlin]" },
    { name: "an offset with hours only", text: "2026-07-15T12:00+02[Europe/Berlin]" },
    { name: "an unclosed bracket", text: "2026-07-15T12:00+02:00[Europe/Berlin" },
    { name: "empty brackets", text: "2026-07-15T12:00+02:00[]" },
    { name: "text after the closing bracket", text: "2026-07-15T12:00+02:00[Europe/Berlin]x" },
    { name: "a second bracketed name", text: "2026-07-15T12:00+02:00[Europe/Berlin][u-ca=iso8601]" },
  ])("refuses $name as not in the form", ({ text }) => {
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: expected <date>T<time>±HH:mm[<zone>].`,
    );
  });

  test.for([
    { name: "a lower-case t separator", local: "2026-07-15t12:00" },
    { name: "a date that does not exist", local: "2026-02-30T12:00" },
    { name: "hour 24", local: "2026-07-15T24:00" },
    { name: "a space for the separator", local: "2026-07-15 12:00" },
    { name: "leading space", local: " 2026-07-15T12:00" },
    { name: "a ten-digit fraction", local: "2026-07-15T12:00:00.1234567890" },
  ])("refuses $name in the local part", ({ local }) => {
    const text = `${local}+02:00[Europe/Berlin]`;
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: ${JSON.stringify(local)} is not a date and a time.`,
    );
  });

  test.for([
    { name: "hour 24", offset: "+24:00" },
    { name: "hour 25", offset: "+25:00" },
    { name: "minute 60", offset: "+02:60" },
    { name: "second 60", offset: "+00:53:60" },
    { name: "a negative hour 99", offset: "-99:00" },
  ])("refuses an offset out of range: $name", ({ offset }) => {
    const text = `2026-07-15T12:00${offset}[Europe/Berlin]`;
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: the offset's hour must be 00-23 and its minute and second 00-59.`,
    );
  });

  test("reads the largest hour, minute and second of an offset as in range and leaves the refusal to the zone", () => {
    const text = "2026-07-15T12:00+23:59:59[Europe/Berlin]";
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: Europe/Berlin does not read 2026-07-15T12:00 at offset +23:59:59.`,
    );
  });

  test.for(["-00:00", "-00:00:00"])("refuses the negative zero offset %s", (offset) => {
    const text = `2026-07-15T12:00${offset}[UTC]`;
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: a zero offset is written +00:00, not -00:00.`,
    );
  });

  test.for([
    { name: "a name Intl does not know", zone: "Mars/Olympus_Mons" },
    { name: "a fixed offset", zone: "+02:00" },
    { name: "Z", zone: "Z" },
  ])("refuses $name in the brackets with a DateTimeParseError, not an UnknownZoneError", ({ zone }) => {
    const text = `2026-07-15T12:00+02:00[${zone}]`;
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect(isUnknownZoneError(error)).toBe(false);
    expect((error as Error).message).toBe(
      `Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: unknown time zone ${JSON.stringify(zone)}.`,
    );
  });

  test.for([
    {
      name: "a winter offset in Berlin's summer",
      text: "2026-07-15T12:00+01:00[Europe/Berlin]",
      detail: "Europe/Berlin does not read 2026-07-15T12:00 at offset +01:00",
    },
    {
      name: "the sign flipped",
      text: "2026-01-15T08:00+05:00[America/New_York]",
      detail: "America/New_York does not read 2026-01-15T08:00 at offset +05:00",
    },
    {
      name: "a zero offset in Berlin",
      text: "2026-07-15T12:00+00:00[Europe/Berlin]",
      detail: "Europe/Berlin does not read 2026-07-15T12:00 at offset +00:00",
    },
    {
      name: "a whole-minute offset for a local mean time",
      text: "1880-06-01T12:00+00:53[Europe/Berlin]",
      detail: "Europe/Berlin does not read 1880-06-01T12:00 at offset +00:53",
    },
    {
      name: "an offset neither reading of an overlap has",
      text: "2026-10-25T02:30+03:00[Europe/Berlin]",
      detail: "Europe/Berlin does not read 2026-10-25T02:30 at offset +03:00",
    },
    {
      name: "a time in a gap with the offset before it",
      text: "2026-03-29T02:30+01:00[Europe/Berlin]",
      detail: "Europe/Berlin does not read 2026-03-29T02:30 at offset +01:00",
    },
    {
      name: "a time in a gap with the offset after it",
      text: "2026-03-29T02:30+02:00[Europe/Berlin]",
      detail: "Europe/Berlin does not read 2026-03-29T02:30 at offset +02:00",
    },
    {
      name: "a time in New York's gap with a seconds offset",
      text: "2026-03-08T02:30:00.5-04:30:30[America/New_York]",
      detail: "America/New_York does not read 2026-03-08T02:30:00.500 at offset -04:30:30",
    },
  ])("refuses an offset the zone does not read the time in: $name", ({ text, detail }) => {
    const error = thrown(() => ZonedDateTime.parse(text));

    expect(isDateTimeParseError(error)).toBe(true);
    expect((error as Error).message).toBe(`Cannot parse ${JSON.stringify(text)} as an ISO 8601 zoned date-time: ${detail}.`);
  });
});

describe("ZonedDateTime.tryParse", () => {
  test("yields success and the value for a zoned date-time", () => {
    const result = ZonedDateTime.tryParse("2026-10-25T02:30+01:00[Europe/Berlin]");

    expect(result.success).toBe(true);
    expect(result.value?.toString()).toBe("2026-10-25T02:30+01:00[Europe/Berlin]");
    expect(result.value?.equals(ZonedDateTime.parse("2026-10-25T02:30+01:00[Europe/Berlin]"))).toBe(true);
  });

  test.for([
    "",
    "next Tuesday",
    "2026-07-15T12:00+02:00",
    "2026-02-30T12:00+01:00[Europe/Berlin]",
    "2026-07-15T12:00+25:00[Europe/Berlin]",
    "2026-07-15T12:00-00:00[UTC]",
    "2026-07-15T12:00+02:00[Mars/Olympus_Mons]",
    "2026-07-15T12:00+01:00[Europe/Berlin]",
    "2026-03-29T02:30+02:00[Europe/Berlin]",
  ])("yields only success: false, without throwing, for %o", (text) => {
    expect(ZonedDateTime.tryParse(text)).toStrictEqual({ success: false });
  });
});
