import { afterEach, describe, expect, test, vi } from "vitest";
import { isUnknownZoneError } from "./errors";
import { Instant } from "./instant";
import { ZoneId } from "./zone-id";

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

/**
 * Makes `Intl.DateTimeFormat().resolvedOptions()` report `timeZone` as the runtime's zone. Only
 * `systemDefault` reads it from a formatter built without an explicit zone.
 */
function useZone(timeZone: string): void {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone };
  });
}

/** The error `ZoneId.of(id)` throws, or `undefined` when it returns. */
function errorFrom(id: string): unknown {
  try {
    ZoneId.of(id);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** `zone`'s offset at the instant `iso` spells, `deltaSeconds` seconds later. */
function offsetAt(zone: string, iso: string, deltaSeconds = 0): number {
  return ZoneId.of(zone).offsetSecondsAt(Instant.parse(iso).plusSeconds(deltaSeconds));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ZoneId.of", () => {
  test.for(["", "Nowhere/Land", "not a zone", "America/New_York/Extra", "+05:30", "+0530", "-08:00", "-08", "Z", "z"])(
    "rejects %o with an UnknownZoneError",
    (id) => {
      const error = errorFrom(id);

      expect(isUnknownZoneError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("common.date-time.unknown-zone");
    },
  );

  test("matches a zone name case-insensitively, to one canonical id", () => {
    const exact = ZoneId.of("America/New_York");
    const lower = ZoneId.of("america/new_york");

    expect(exact.id).toBe("America/New_York");
    expect(lower.id).toBe(exact.id);
    expect(lower.equals(exact)).toBe(true);
  });

  test.for(["UTC", "Etc/UTC", "GMT", "EST", "Asia/Kolkata"])("accepts %o", (id) => {
    const zone = ZoneId.of(id);

    expect(typeof zone.id).toBe("string");
    expect(zone.id.length).toBeGreaterThan(0);
  });

  test("reads UTC under one canonical id however it is spelled", () => {
    expect(ZoneId.of("utc").equals(ZoneId.of("UTC"))).toBe(true);
    expect(ZoneId.of("UTC").id).toMatch(/^(?:Etc\/)?UTC$/);
  });

  test("returns a frozen instance", () => {
    expect(Object.isFrozen(ZoneId.of("Europe/Berlin"))).toBe(true);
  });
});

describe("ZoneId#equals", () => {
  test("is false for different zones", () => {
    expect(ZoneId.of("Europe/Berlin").equals(ZoneId.of("America/New_York"))).toBe(false);
  });
});

describe("ZoneId#toString", () => {
  test("is the id", () => {
    const zone = ZoneId.of("asia/kolkata");

    expect(zone.toString()).toBe(zone.id);
    expect(`${ZoneId.of("Europe/Berlin")}`).toBe("Europe/Berlin");
  });
});

describe("ZoneId.systemDefault", () => {
  test("is the runtime's zone", () => {
    useZone("Europe/Berlin");

    expect(ZoneId.systemDefault().equals(ZoneId.of("Europe/Berlin"))).toBe(true);
  });

  test("reads the runtime's zone on every call", () => {
    useZone("Europe/Berlin");
    const first = ZoneId.systemDefault();
    useZone("America/New_York");
    const second = ZoneId.systemDefault();

    expect(first.id).toBe("Europe/Berlin");
    expect(second.id).toBe("America/New_York");
  });

  test("returns a frozen instance", () => {
    expect(Object.isFrozen(ZoneId.systemDefault())).toBe(true);
  });
});

describe("ZoneId#offsetSecondsAt", () => {
  test("follows Berlin's spring-forward", () => {
    expect(offsetAt("Europe/Berlin", "2026-03-29T01:00:00Z", -1)).toBe(3600);
    expect(offsetAt("Europe/Berlin", "2026-03-29T01:00:00Z")).toBe(7200);
  });

  test("follows Berlin's fall-back", () => {
    expect(offsetAt("Europe/Berlin", "2026-10-25T01:00:00Z", -1)).toBe(7200);
    expect(offsetAt("Europe/Berlin", "2026-10-25T01:00:00Z")).toBe(3600);
  });

  test("follows New York's spring-forward", () => {
    expect(offsetAt("America/New_York", "2026-03-08T07:00:00Z", -1)).toBe(-18_000);
    expect(offsetAt("America/New_York", "2026-03-08T07:00:00Z")).toBe(-14_400);
  });

  test("follows New York's fall-back", () => {
    expect(offsetAt("America/New_York", "2026-11-01T06:00:00Z", -1)).toBe(-14_400);
    expect(offsetAt("America/New_York", "2026-11-01T06:00:00Z")).toBe(-18_000);
  });

  test("reads a half-hour offset", () => {
    expect(offsetAt("Asia/Kolkata", "2026-10-01T12:00:00Z")).toBe(19_800);
  });

  test("is zero in UTC", () => {
    expect(offsetAt("UTC", "2026-10-01T12:00:00Z")).toBe(0);
  });

  test("reads local mean time to the second", () => {
    expect(offsetAt("Europe/Berlin", "1880-01-01T00:00:00Z")).toBe(3208);
  });

  test("ignores the fraction of the second", () => {
    const berlin = ZoneId.of("Europe/Berlin");
    const instant = Instant.parse("2026-03-29T00:59:59.999999999Z");

    expect(berlin.offsetSecondsAt(instant)).toBe(3600);
  });

  test("reads an instant before year 1", () => {
    expect(ZoneId.of("Europe/Berlin").offsetSecondsAt(Instant.ofEpochSecond(-62_200_000_000))).toBe(3208);
    expect(ZoneId.of("UTC").offsetSecondsAt(Instant.ofEpochSecond(-62_200_000_000))).toBe(0);
  });

  test("reads an instant in year 10000", () => {
    expect(ZoneId.of("America/New_York").offsetSecondsAt(Instant.ofEpochSecond(253_402_300_800))).toBe(-18_000);
  });

  test("reads both ends of the instant range", () => {
    for (const second of [-8_640_000_000_000, 8_640_000_000_000]) {
      const offset = ZoneId.of("Europe/Berlin").offsetSecondsAt(Instant.ofEpochSecond(second));

      expect(Number.isInteger(offset)).toBe(true);
    }
  });
});
