import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
import { DateTimeParseError, isDateTimeParseError, isInvalidDateTimeError, isZoneResolutionError } from "./errors";
import { LocalDate } from "./local-date";
import { LocalDateTime } from "./local-date-time";
import { LocalTime } from "./local-time";
import { ZoneId } from "./zone-id";
import { ZonedDateTime } from "./zoned-date-time";

test("of combines a date and a time", () => {
  const date = LocalDate.of(2026, 10, 1);
  const time = LocalTime.of(14, 30);
  const value = LocalDateTime.of(date, time);
  expect(value.date).toBe(date);
  expect(value.time).toBe(time);
});

test("ofFields defaults the second and the nanosecond to zero", () => {
  const value = LocalDateTime.ofFields(2026, 10, 1, 14, 30);
  expect(value.date.equals(LocalDate.of(2026, 10, 1))).toBe(true);
  expect(value.time.equals(LocalTime.of(14, 30, 0, 0))).toBe(true);
});

test("ofFields takes every field", () => {
  const value = LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, 250_000_000);
  expect(value.time.nanosecond).toBe(250_000_000);
  expect(value.toString()).toBe("2026-10-01T14:30:05.250");
  expect(LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, 123_456_789).toString()).toBe("2026-10-01T14:30:05.123456789");
});

test("ofFields rejects a nanosecond outside 0 to 999 999 999 with InvalidDateTimeError", () => {
  for (const nanosecond of [-1, 1_000_000_000, 0.5]) {
    try {
      LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, nanosecond);
      expect.unreachable();
    } catch (error) {
      expect(isInvalidDateTimeError(error)).toBe(true);
    }
  }
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
  "2026-10-01T14:30:05.123456",
  "2026-10-01T14:30:05.000001",
  "2026-10-01T14:30:05.123456789",
  "2026-10-01T00:00",
  "0001-01-01T00:00",
  "9999-12-31T23:59:59.999999999",
])("parse then toString round-trips %s", (iso) => {
  expect(LocalDateTime.parse(iso).toString()).toBe(iso);
  const result = LocalDateTime.tryParse(iso);
  expect(result.success).toBe(true);
  expect(result.value?.toString()).toBe(iso);
});

test("parse reads the fields of each form", () => {
  const value = LocalDateTime.parse("2026-10-01T14:30:05.25");
  expect(value.equals(LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, 250_000_000))).toBe(true);
  expect(value.time.nanosecond).toBe(250_000_000);
  expect(LocalDateTime.parse("2026-10-01T14:30:05.1234").time.nanosecond).toBe(123_400_000);
  expect(LocalDateTime.parse("2026-10-01T14:30:05.000000001").time.nanosecond).toBe(1);
});

test("parse writes the fraction back in the shortest of 3, 6 or 9 digits", () => {
  expect(LocalDateTime.parse("2026-10-01T14:30:05.1").toString()).toBe("2026-10-01T14:30:05.100");
  expect(LocalDateTime.parse("2026-10-01T14:30:05.1234").toString()).toBe("2026-10-01T14:30:05.123400");
  expect(LocalDateTime.parse("2026-10-01T14:30:05.1234567").toString()).toBe("2026-10-01T14:30:05.123456700");
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
  "2026-10-01T10:00:00.",
  "2026-10-01T10:00:00.1234567890",
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

/** `str` with every whitespace character as a regular space, so ICU's U+202F compares equal to it. */
const spaced = (str: string): string => str.replace(/\s/g, " ");

describe("LocalDateTime#format", () => {
  const value = LocalDateTime.ofFields(2026, 2, 3, 13, 30);

  test.for([
    ["en-US", "02/03/2026, 01:30 PM"],
    ["en-GB", "03/02/2026, 13:30"],
    ["de-DE", "03.02.2026, 13:30"],
    ["fr-FR", "03/02/2026 13:30"],
    ["ja-JP", "2026/02/03 13:30"],
    ["en-GB-u-hc-h12", "03/02/2026, 01:30 pm"],
    ["en-US-u-hc-h23", "02/03/2026, 13:30"],
  ] as const)("writes 2026-02-03T13:30 in %s as %s", ([tag, expected]) => {
    expect(spaced(value.format(new Locale(tag)))).toBe(expected);
  });

  test("writes the date and the time as their own format does, in the locale's layout", () => {
    for (const tag of ["en-US", "ar-EG", "he-IL", "ko-KR", "vi"]) {
      const locale = new Locale(tag);
      const formatted = value.format(locale);

      expect(formatted).toContain(value.date.format(locale));
      expect(formatted).toContain(value.time.format(locale));
    }
  });

  test("writes the time first where the locale does", () => {
    const locale = new Locale("vi");
    const formatted = value.format(locale);

    expect(formatted.indexOf(value.time.format(locale))).toBeLessThan(formatted.indexOf(value.date.format(locale)));
  });

  test("writes midnight as 00:00 on a 24-hour clock, even where the locale's cycle is h24", () => {
    expect(LocalDateTime.ofFields(2026, 2, 3, 0, 0).format(new Locale("en-US-u-hc-h24"))).toBe("02/03/2026, 00:00");
  });

  test("writes the second and the nanosecond nowhere", () => {
    expect(LocalDateTime.ofFields(2026, 2, 3, 13, 30, 45, 999_999_999).format(new Locale("de-DE"))).toBe("03.02.2026, 13:30");
  });

  test("an omitted locale writes in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(value.format()).toBe("03.02.2026, 13:30");
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves toString as the ISO 8601 form", () => {
    expect(value.toString()).toBe("2026-02-03T13:30");
  });
});

describe("LocalDateTime.parseLocalized and tryParseLocalized", () => {
  const LOCALES = [
    "en-US",
    "en-GB",
    "de-DE",
    "ja-JP",
    "ar-EG",
    "he-IL",
    "fr-FR",
    "ko-KR",
    "vi",
    "en-GB-u-hc-h12",
    "en-US-u-hc-h23",
    "en-US-u-hc-h24",
  ];
  const VALUES = ["0001-01-01T00:00", "2024-02-29T00:30", "2026-02-03T12:00", "2026-10-01T12:30", "2026-10-01T13:05", "9999-12-31T23:59"];

  test.for(LOCALES.flatMap((tag) => VALUES.map((iso) => [tag, iso] as const)))("round-trips %s through format in %s", ([tag, iso]) => {
    const locale = new Locale(tag);
    const formatted = LocalDateTime.parse(iso).format(locale);

    expect(LocalDateTime.parseLocalized(formatted, locale).toString()).toBe(iso);
    expect(LocalDateTime.tryParseLocalized(formatted, locale).value?.toString()).toBe(iso);
  });

  test("reads back a date-time with seconds at second 0 and nanosecond 0", () => {
    const locale = new Locale("en-US");
    const value = LocalDateTime.parseLocalized(LocalDateTime.ofFields(2026, 2, 3, 13, 30, 45, 999_999_999).format(locale), locale);

    expect(value.equals(LocalDateTime.ofFields(2026, 2, 3, 13, 30))).toBe(true);
  });

  test("reads the date and the time each in the locale's own pattern", () => {
    const value = LocalDateTime.parseLocalized("2/3/2026, 1:05 pm", new Locale("en-US"));

    expect(value.equals(LocalDateTime.ofFields(2026, 2, 3, 13, 5))).toBe(true);
  });

  test("returns the value on success", () => {
    const result = LocalDateTime.tryParseLocalized("03.02.2026, 09:05", new Locale("de-DE"));

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalDateTime.ofFields(2026, 2, 3, 9, 5))).toBe(true);
  });

  test.for([
    "02/30/2026, 10:00 AM",
    "02/03/2026, 13:00 PM",
    "02/03/2026, 00:00 AM",
    "02/03/2026, 12:60 PM",
    "02/03/2026 10:00 AM",
    "10:00 AM, 02/03/2026",
    "02/03/2026, 10:00",
    "02/03/2026",
    "2026-02-03T10:00",
    "",
  ])("rejects %o in en-US", (str) => {
    const locale = new Locale("en-US");

    expect(LocalDateTime.tryParseLocalized(str, locale)).toEqual({ success: false });
    expect(() => LocalDateTime.parseLocalized(str, locale)).toThrow(DateTimeParseError);
  });

  test("rejects an hour past 23 on a 24-hour clock", () => {
    expect(LocalDateTime.tryParseLocalized("03.02.2026, 24:00", new Locale("de-DE"))).toEqual({ success: false });
  });

  test("throws an error the guard recognises, not InvalidDateTimeError", () => {
    try {
      LocalDateTime.parseLocalized("02/30/2026, 10:00 AM", new Locale("en-US"));
      expect.unreachable("LocalDateTime.parseLocalized accepted February 30");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
      expect(isInvalidDateTimeError(error)).toBe(false);
    }
  });

  test("quotes the input and names the locale in the message", () => {
    expect(() => LocalDateTime.parseLocalized("nope", new Locale("de-DE"))).toThrow('Cannot parse "nope" as a date-time in de-DE.');
  });

  test("an omitted locale reads in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(LocalDateTime.parseLocalized("03.02.2026, 13:30").equals(LocalDateTime.ofFields(2026, 2, 3, 13, 30))).toBe(true);
      expect(LocalDateTime.tryParseLocalized("03.02.2026, 13:30").value?.equals(LocalDateTime.ofFields(2026, 2, 3, 13, 30))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves parse and tryParse reading ISO 8601 only", () => {
    expect(LocalDateTime.tryParse("02/03/2026, 01:30 PM")).toEqual({ success: false });
    expect(LocalDateTime.parse("2026-02-03T13:30").equals(LocalDateTime.ofFields(2026, 2, 3, 13, 30))).toBe(true);
  });
});

describe("LocalDateTime#atZone in a time zone", () => {
  /** A value's local date-time, offset and instant as plain strings and numbers, for one `toEqual`. */
  function zonedParts(value: ZonedDateTime): { local: string; offsetSeconds: number; instant: string } {
    return { local: value.toLocalDateTime().toString(), offsetSeconds: value.offsetSeconds, instant: value.toInstant().toString() };
  }

  test("keeps a time the zone reads once as the value's toLocalDateTime, in the zone given", () => {
    const local = LocalDateTime.parse("2026-07-15T13:45:30.123456789");
    const zone = ZoneId.of("Europe/Berlin");
    const value = local.atZone(zone);

    expect(value.toLocalDateTime()).toBe(local);
    expect(value.zone).toBe(zone);
    expect(zonedParts(value)).toEqual({
      local: "2026-07-15T13:45:30.123456789",
      offsetSeconds: 7200,
      instant: "2026-07-15T11:45:30.123456789Z",
    });
  });

  test("settles a time in a gap as ZonedDateTime.of does, compatible by default", () => {
    const local = LocalDateTime.parse("2026-03-29T02:30");
    const zone = ZoneId.of("Europe/Berlin");

    expect(zonedParts(local.atZone(zone))).toEqual({ local: "2026-03-29T03:30", offsetSeconds: 7200, instant: "2026-03-29T01:30:00Z" });
    expect(local.atZone(zone).equals(ZonedDateTime.of(local, zone))).toBe(true);
  });

  test("passes the disambiguation through", () => {
    const zone = ZoneId.of("Europe/Berlin");

    expect(zonedParts(LocalDateTime.parse("2026-03-29T02:30").atZone(zone, { disambiguation: "earlier" }))).toEqual({
      local: "2026-03-29T01:30",
      offsetSeconds: 3600,
      instant: "2026-03-29T00:30:00Z",
    });
    expect(zonedParts(LocalDateTime.parse("2026-10-25T02:30").atZone(zone, { disambiguation: "later" }))).toEqual({
      local: "2026-10-25T02:30",
      offsetSeconds: 3600,
      instant: "2026-10-25T01:30:00Z",
    });
  });

  test("throws ZoneResolutionError under reject for a time in a gap", () => {
    let error: unknown;
    try {
      LocalDateTime.parse("2026-03-29T02:30").atZone(ZoneId.of("Europe/Berlin"), { disambiguation: "reject" });
    } catch (caught) {
      error = caught;
    }
    expect(isZoneResolutionError(error)).toBe(true);
  });
});
