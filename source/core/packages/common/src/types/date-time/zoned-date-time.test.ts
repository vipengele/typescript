import { describe, expect, test } from "vitest";
import { isZoneResolutionError } from "./errors";
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
