import { describe, expect, test } from "vitest";
import { isZoneResolutionError } from "./errors";
import { LocalDateTime } from "./local-date-time";
import { ZoneId } from "./zone-id";
import { type Disambiguation, disambiguate, resolveLocal } from "./zone-resolve";

/** `disambiguate(local, zone, mode)` as plain strings and numbers, for one `toEqual`. */
function resolved(local: string, zone: string, mode?: Disambiguation): { local: string; offsetSeconds: number } {
  const result = disambiguate(LocalDateTime.parse(local), ZoneId.of(zone), mode);
  return { local: result.local.toString(), offsetSeconds: result.offsetSeconds };
}

/** The error `disambiguate(local, zone, "reject")` throws, or `undefined` when it returns. */
function rejection(local: string, zone: string): unknown {
  try {
    disambiguate(LocalDateTime.parse(local), ZoneId.of(zone), "reject");
  } catch (error) {
    return error;
  }
  return undefined;
}

const MODES: readonly Disambiguation[] = ["compatible", "earlier", "later", "reject"];

/**
 * A time in a gap: the zone's offsets either side of it, and where `earlier` and `later` (and
 * `compatible`, which follows `later`) move it.
 */
const GAPS = [
  {
    name: "Europe/Berlin spring-forward, one hour",
    zone: "Europe/Berlin",
    local: "2026-03-29T02:30:15.123456789",
    offsetBefore: 3600,
    offsetAfter: 7200,
    earlier: "2026-03-29T01:30:15.123456789",
    later: "2026-03-29T03:30:15.123456789",
  },
  {
    name: "America/New_York spring-forward, one hour",
    zone: "America/New_York",
    local: "2026-03-08T02:00",
    offsetBefore: -18_000,
    offsetAfter: -14_400,
    earlier: "2026-03-08T01:00",
    later: "2026-03-08T03:00",
  },
  {
    name: "Australia/Lord_Howe spring-forward, thirty minutes",
    zone: "Australia/Lord_Howe",
    local: "2026-10-04T02:15:00.5",
    offsetBefore: 37_800,
    offsetAfter: 39_600,
    earlier: "2026-10-04T01:45:00.500",
    later: "2026-10-04T02:45:00.500",
  },
  {
    name: "Pacific/Apia skipping 2011-12-30, twenty-four hours",
    zone: "Pacific/Apia",
    local: "2011-12-30T12:00",
    offsetBefore: -36_000,
    offsetAfter: 50_400,
    earlier: "2011-12-29T12:00",
    later: "2011-12-31T12:00",
  },
];

/** A time in an overlap: the zone's offsets either side of it, the earlier instant's first. */
const OVERLAPS = [
  {
    name: "Europe/Berlin fall-back, one hour",
    zone: "Europe/Berlin",
    local: "2026-10-25T02:30:15.123456789",
    offsetBefore: 7200,
    offsetAfter: 3600,
  },
  {
    name: "America/New_York fall-back, one hour",
    zone: "America/New_York",
    local: "2026-11-01T01:00",
    offsetBefore: -14_400,
    offsetAfter: -18_000,
  },
  {
    name: "Australia/Lord_Howe fall-back, thirty minutes",
    zone: "Australia/Lord_Howe",
    local: "2026-04-05T01:45",
    offsetBefore: 39_600,
    offsetAfter: 37_800,
  },
];

/** A time that names exactly one instant, at the edges of transitions and away from them. */
const UNIQUES = [
  { name: "the nanosecond before Berlin's gap", zone: "Europe/Berlin", local: "2026-03-29T01:59:59.999999999", offset: 3600 },
  { name: "the end of Berlin's gap", zone: "Europe/Berlin", local: "2026-03-29T03:00", offset: 7200 },
  { name: "the nanosecond before Berlin's overlap", zone: "Europe/Berlin", local: "2026-10-25T01:59:59.999999999", offset: 7200 },
  { name: "the end of Berlin's overlap", zone: "Europe/Berlin", local: "2026-10-25T03:00", offset: 3600 },
  { name: "New York in summer", zone: "America/New_York", local: "2026-07-01T12:00", offset: -14_400 },
  { name: "the end of New York's overlap", zone: "America/New_York", local: "2026-11-01T02:00", offset: -18_000 },
  { name: "the end of Lord Howe's gap", zone: "Australia/Lord_Howe", local: "2026-10-04T02:30", offset: 39_600 },
  { name: "the day before Apia's gap", zone: "Pacific/Apia", local: "2011-12-29T23:59:59", offset: -36_000 },
  { name: "the day after Apia's gap", zone: "Pacific/Apia", local: "2011-12-31T00:00", offset: 50_400 },
  { name: "Berlin's local mean time, whole seconds", zone: "Europe/Berlin", local: "1880-06-01T12:00", offset: 3208 },
];

describe("resolveLocal", () => {
  test.for(GAPS)("finds a gap: $name", ({ zone, local, offsetBefore, offsetAfter }) => {
    expect(resolveLocal(LocalDateTime.parse(local), ZoneId.of(zone))).toEqual({ kind: "gap", offsetBefore, offsetAfter });
  });

  test.for(OVERLAPS)("finds an overlap: $name", ({ zone, local, offsetBefore, offsetAfter }) => {
    expect(resolveLocal(LocalDateTime.parse(local), ZoneId.of(zone))).toEqual({ kind: "overlap", offsetBefore, offsetAfter });
  });

  test.for(UNIQUES)("finds a unique offset: $name", ({ zone, local, offset }) => {
    expect(resolveLocal(LocalDateTime.parse(local), ZoneId.of(zone))).toEqual({ kind: "unique", offsetSeconds: offset });
  });
});

describe("disambiguate in a gap", () => {
  test.for(GAPS)("compatible moves forward by the gap's length to the offset after: $name", ({ zone, local, offsetAfter, later }) => {
    expect(resolved(local, zone, "compatible")).toEqual({ local: later, offsetSeconds: offsetAfter });
  });

  test.for(GAPS)("compatible is the default: $name", ({ zone, local, offsetAfter, later }) => {
    expect(resolved(local, zone)).toEqual({ local: later, offsetSeconds: offsetAfter });
  });

  test.for(GAPS)("earlier moves back by the gap's length to the offset before: $name", ({ zone, local, offsetBefore, earlier }) => {
    expect(resolved(local, zone, "earlier")).toEqual({ local: earlier, offsetSeconds: offsetBefore });
  });

  test.for(GAPS)("later moves forward by the gap's length to the offset after: $name", ({ zone, local, offsetAfter, later }) => {
    expect(resolved(local, zone, "later")).toEqual({ local: later, offsetSeconds: offsetAfter });
  });

  test.for(GAPS)("reject throws a ZoneResolutionError saying the time does not exist: $name", ({ zone, local }) => {
    const error = rejection(local, zone);
    const canonical = LocalDateTime.parse(local).toString();

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe(`The local date-time ${canonical} does not exist in ${ZoneId.of(zone).id}.`);
  });

  test("names the instant the time reads as in the offset on the other side", () => {
    const zone = ZoneId.of("Pacific/Apia");
    const local = LocalDateTime.parse("2011-12-30T12:00");
    const forward = disambiguate(local, zone, "later");
    const back = disambiguate(local, zone, "earlier");

    expect(resolveLocal(forward.local, zone)).toEqual({ kind: "unique", offsetSeconds: forward.offsetSeconds });
    expect(resolveLocal(back.local, zone)).toEqual({ kind: "unique", offsetSeconds: back.offsetSeconds });
  });
});

describe("disambiguate in an overlap", () => {
  test.for(OVERLAPS)("compatible keeps the time and takes the earlier instant's offset: $name", ({ zone, local, offsetBefore }) => {
    expect(resolved(local, zone, "compatible")).toEqual({ local: LocalDateTime.parse(local).toString(), offsetSeconds: offsetBefore });
  });

  test.for(OVERLAPS)("compatible is the default: $name", ({ zone, local, offsetBefore }) => {
    expect(resolved(local, zone)).toEqual({ local: LocalDateTime.parse(local).toString(), offsetSeconds: offsetBefore });
  });

  test.for(OVERLAPS)("earlier keeps the time and takes the earlier instant's offset: $name", ({ zone, local, offsetBefore }) => {
    expect(resolved(local, zone, "earlier")).toEqual({ local: LocalDateTime.parse(local).toString(), offsetSeconds: offsetBefore });
  });

  test.for(OVERLAPS)("later keeps the time and takes the later instant's offset: $name", ({ zone, local, offsetAfter }) => {
    expect(resolved(local, zone, "later")).toEqual({ local: LocalDateTime.parse(local).toString(), offsetSeconds: offsetAfter });
  });

  test.for(OVERLAPS)("reject throws a ZoneResolutionError saying the time is ambiguous: $name", ({ zone, local }) => {
    const error = rejection(local, zone);
    const canonical = LocalDateTime.parse(local).toString();

    expect(isZoneResolutionError(error)).toBe(true);
    expect((error as Error).message).toBe(`The local date-time ${canonical} is ambiguous in ${ZoneId.of(zone).id}.`);
  });

  test("returns the same LocalDateTime it was given", () => {
    const local = LocalDateTime.parse("2026-10-25T02:30");

    expect(disambiguate(local, ZoneId.of("Europe/Berlin"), "later").local).toBe(local);
  });
});

describe("disambiguate on a unique time", () => {
  test.for(UNIQUES.flatMap((unique) => MODES.map((mode) => ({ ...unique, mode }))))(
    "$mode returns the time and its one offset: $name",
    ({ zone, local, offset, mode }) => {
      const value = LocalDateTime.parse(local);
      const result = disambiguate(value, ZoneId.of(zone), mode);

      expect(result.local).toBe(value);
      expect(result.offsetSeconds).toBe(offset);
    },
  );
});
