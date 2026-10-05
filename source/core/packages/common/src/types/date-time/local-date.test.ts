import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
import { DateTimeParseError, InvalidDateTimeError, isDateTimeParseError, isInvalidDateTimeError, isZoneResolutionError } from "./errors";
import { LocalDate } from "./local-date";
import { ZoneId } from "./zone-id";
import type { ZonedDateTime } from "./zoned-date-time";

const date = (str: string): LocalDate => LocalDate.parse(str);

describe("LocalDate.of", () => {
  test("holds the fields it is given", () => {
    const value = LocalDate.of(2026, 10, 1);

    expect([value.year, value.month, value.day]).toEqual([2026, 10, 1]);
  });

  test("accepts February 29 in a leap year", () => {
    expect(LocalDate.of(2024, 2, 29).toString()).toBe("2024-02-29");
  });

  test("accepts both ends of the supported range", () => {
    expect(LocalDate.of(1, 1, 1).toString()).toBe("0001-01-01");
    expect(LocalDate.of(9999, 12, 31).toString()).toBe("9999-12-31");
  });

  test.for([
    [2026, 2, 30],
    [2026, 2, 29],
    [1900, 2, 29],
    [2026, 4, 31],
    [2026, 13, 1],
    [2026, 0, 1],
    [2026, 1, 0],
    [2026, 1, 32],
    [0, 1, 1],
    [10_000, 1, 1],
    [2026.5, 1, 1],
    [2026, 1.5, 1],
    [2026, 1, 1.5],
    [Number.NaN, 1, 1],
    [2026, Number.POSITIVE_INFINITY, 1],
  ])("rejects %s-%s-%s with InvalidDateTimeError", ([year, month, day]) => {
    expect(() => LocalDate.of(year as number, month as number, day as number)).toThrow(InvalidDateTimeError);
  });

  test("names the offending field in the message", () => {
    expect(() => LocalDate.of(2026, 2, 30)).toThrow("day must be an integer from 1 to 28 in 2026-02, got 30");
    expect(() => LocalDate.of(2026, 13, 1)).toThrow("month must be an integer from 1 to 12, got 13");
    expect(() => LocalDate.of(0, 1, 1)).toThrow("year must be an integer from 1 to 9999, got 0");
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalDate.of(2026, 2, 30);
      expect.unreachable("LocalDate.of accepted February 30");
    } catch (error) {
      expect(isInvalidDateTimeError(error)).toBe(true);
    }
  });

  test("returns a frozen value", () => {
    const value = LocalDate.of(2026, 10, 1);

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as { day: number }).day = 2;
    }).toThrow(TypeError);
  });
});

describe("LocalDate.parse", () => {
  test.for(["2026-10-01", "2024-02-29", "0001-01-01", "9999-12-31", "1999-12-31"])("round-trips %s", (str) => {
    expect(LocalDate.parse(str).toString()).toBe(str);
  });

  test("reads the fields", () => {
    expect(LocalDate.parse("2026-10-01").equals(LocalDate.of(2026, 10, 1))).toBe(true);
  });

  test.for([
    "2026-02-30",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
    "0000-01-01",
    "2026-1-01",
    "2026-01-1",
    "26-01-01",
    "+2026-01-01",
    "-2026-01-01",
    "20260101",
    "2026/01/01",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01T00:00",
    "2026-W40-4",
    "",
    "nope",
  ])("rejects %o with DateTimeParseError", (str) => {
    expect(() => LocalDate.parse(str)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises, not InvalidDateTimeError", () => {
    try {
      LocalDate.parse("2026-02-30");
      expect.unreachable("LocalDate.parse accepted February 30");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
      expect(isInvalidDateTimeError(error)).toBe(false);
    }
  });

  test("quotes the input in the message", () => {
    expect(() => LocalDate.parse("nope")).toThrow('Cannot parse "nope" as an ISO 8601 date.');
  });
});

describe("LocalDate.tryParse", () => {
  test("returns the value on success", () => {
    const result = LocalDate.tryParse("2026-10-01");

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalDate.of(2026, 10, 1))).toBe(true);
  });

  test.for(["2026-02-30", "nope"])("returns { success: false } for %o", (str) => {
    expect(LocalDate.tryParse(str)).toEqual({ success: false });
  });
});

describe("LocalDate.compare and equals", () => {
  const ordered = ["2025-12-31", "2026-01-01", "2026-01-02", "2026-02-01", "2027-01-01"].map(date);

  test("orders by year, then month, then day", () => {
    expect([...ordered].reverse().sort(LocalDate.compare)).toEqual(ordered);
  });

  test("is zero exactly when equals holds", () => {
    for (const a of ordered) {
      for (const b of ordered) {
        expect(LocalDate.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDate.compare(a, b)) + Math.sign(LocalDate.compare(b, a))).toBe(0);
      }
    }
  });

  test("treats separately built instances of one date as equal", () => {
    expect(LocalDate.of(2026, 10, 1).equals(date("2026-10-01"))).toBe(true);
    expect(LocalDate.compare(LocalDate.of(2026, 10, 1), date("2026-10-01"))).toBe(0);
  });
});

describe("LocalDate day of the week", () => {
  test.for([
    ["2026-10-01", 4],
    ["2026-09-28", 1],
    ["2026-10-04", 7],
    ["2000-01-01", 6],
    ["1970-01-01", 4],
    ["0001-01-01", 1],
    ["9999-12-31", 5],
  ] as const)("%s is ISO day %i", ([str, dayOfWeek]) => {
    expect(date(str).dayOfWeek).toBe(dayOfWeek);
  });
});

describe("LocalDate#lengthOfMonth", () => {
  test.for([
    ["2026-01-15", 31],
    ["2026-02-01", 28],
    ["2024-02-01", 29],
    ["2026-04-30", 30],
  ] as const)("%s is in a %i-day month", ([str, length]) => {
    expect(date(str).lengthOfMonth).toBe(length);
  });
});

describe("LocalDate#plusDays and minusDays", () => {
  test.for([
    ["2026-10-01", 1, "2026-10-02"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-10-01", 0, "2026-10-01"],
    ["2026-10-01", -1, "2026-09-30"],
    ["2026-10-01", 365, "2027-10-01"],
    ["2024-01-01", 366, "2025-01-01"],
  ] as const)("%s plus %i days is %s", ([from, days, to]) => {
    expect(date(from).plusDays(days).toString()).toBe(to);
    expect(date(to).minusDays(days).toString()).toBe(from);
  });

  test("leaves the receiver unchanged", () => {
    const value = date("2026-10-01");
    value.plusDays(10);

    expect(value.toString()).toBe("2026-10-01");
  });

  test("throws InvalidDateTimeError past the end of the supported range", () => {
    expect(() => date("9999-12-31").plusDays(1)).toThrow(InvalidDateTimeError);
    expect(() => date("0001-01-01").minusDays(1)).toThrow(InvalidDateTimeError);
  });

  test.for([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects an amount of %s with RangeError", (amount) => {
    expect(() => date("2026-10-01").plusDays(amount)).toThrow(RangeError);
    expect(() => date("2026-10-01").minusDays(amount)).toThrow(RangeError);
  });
});

describe("LocalDate#plusMonths and minusMonths", () => {
  test.for([
    ["2026-10-01", 1, "2026-11-01"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2024-01-31", 1, "2024-02-29"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-10-01", 0, "2026-10-01"],
    ["2026-10-01", 12, "2027-10-01"],
    ["2026-10-01", -10, "2025-12-01"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
  ] as const)("%s plus %i months is %s", ([from, months, to]) => {
    expect(date(from).plusMonths(months).toString()).toBe(to);
  });

  test.for([
    ["2024-03-31", 1, "2024-02-29"],
    ["2026-03-31", 1, "2026-02-28"],
    ["2024-02-29", 12, "2023-02-28"],
    ["2026-01-15", 1, "2025-12-15"],
    ["2026-10-01", -3, "2027-01-01"],
  ] as const)("%s minus %i months is %s", ([from, months, to]) => {
    expect(date(from).minusMonths(months).toString()).toBe(to);
  });

  test("throws InvalidDateTimeError past the end of the supported range", () => {
    expect(() => date("9999-12-01").plusMonths(1)).toThrow(InvalidDateTimeError);
    expect(() => date("0001-01-31").minusMonths(1)).toThrow(InvalidDateTimeError);
  });

  test.for([1.5, Number.NaN, Number.NEGATIVE_INFINITY])("rejects an amount of %s with RangeError", (amount) => {
    expect(() => date("2026-10-01").plusMonths(amount)).toThrow(RangeError);
    expect(() => date("2026-10-01").minusMonths(amount)).toThrow(RangeError);
  });
});

describe("LocalDate#toString", () => {
  test("pads every field", () => {
    expect(LocalDate.of(987, 6, 5).toString()).toBe("0987-06-05");
  });

  test("is what a template literal writes", () => {
    expect(`${LocalDate.of(2026, 10, 1)}`).toBe("2026-10-01");
  });
});

describe("LocalDate#format", () => {
  test.for([
    ["en-US", "02/03/2026"],
    ["en-GB", "03/02/2026"],
    ["de-DE", "03.02.2026"],
    ["ja-JP", "2026/02/03"],
  ] as const)("writes 2026-02-03 in %s as %s", ([tag, expected]) => {
    expect(LocalDate.of(2026, 2, 3).format(new Locale(tag))).toBe(expected);
  });

  test("writes ASCII digits in a locale whose default numbering system is not latn", () => {
    expect(LocalDate.of(2026, 2, 3).format(new Locale("ar-EG")).replace(/[‎‏؜]/g, "")).toBe("03/02/2026");
  });

  test.for(["en-US", "de-DE", "ar-EG", "he-IL"])("matches Intl's own numeric spelling in %s", (tag) => {
    const intl = new Intl.DateTimeFormat(tag, {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(Date.UTC(2026, 9, 1));

    expect(LocalDate.of(2026, 10, 1).format(new Locale(tag))).toBe(intl);
  });

  test("an omitted locale writes in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(LocalDate.of(2026, 2, 3).format()).toBe("03.02.2026");
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves toString as the ISO 8601 form", () => {
    expect(LocalDate.of(2026, 2, 3).toString()).toBe("2026-02-03");
  });
});

describe("LocalDate#segments", () => {
  const date = LocalDate.of(2026, 2, 3);

  test("en-US writes month, day, year", () => {
    expect(date.segments(new Locale("en-US"))).toEqual([
      { type: "month", value: "02" },
      { type: "literal", value: "/" },
      { type: "day", value: "03" },
      { type: "literal", value: "/" },
      { type: "year", value: "2026" },
    ]);
  });

  test("en-GB writes day, month, year", () => {
    expect(date.segments(new Locale("en-GB"))).toEqual([
      { type: "day", value: "03" },
      { type: "literal", value: "/" },
      { type: "month", value: "02" },
      { type: "literal", value: "/" },
      { type: "year", value: "2026" },
    ]);
  });

  test("ja-JP writes year, month, day between literal separators", () => {
    expect(date.segments(new Locale("ja-JP"))).toEqual([
      { type: "year", value: "2026" },
      { type: "literal", value: "/" },
      { type: "month", value: "02" },
      { type: "literal", value: "/" },
      { type: "day", value: "03" },
    ]);
  });

  test.for(["en-US", "en-GB", "de-DE", "ja-JP", "ar-EG", "he-IL", "hu-HU", "th-TH", "fa-IR"])(
    "joins to format's output and Intl's own spelling in %s",
    (tag) => {
      const locale = new Locale(tag);
      const intl = new Intl.DateTimeFormat(tag, {
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(Date.UTC(2026, 1, 3));
      const joined = date
        .segments(locale)
        .map((segment) => segment.value)
        .join("");

      expect(joined).toBe(date.format(locale));
      expect(joined).toBe(intl);
    },
  );

  test.for(["en-US", "ja-JP", "ar-EG", "hu-HU"])("holds no empty segment in %s", (tag) => {
    for (const segment of date.segments(new Locale(tag))) {
      expect(segment.value).not.toBe("");
    }
  });

  test("hu-HU ends with the literal after the day", () => {
    expect(date.segments(new Locale("hu-HU")).at(-1)).toEqual({ type: "literal", value: "." });
  });

  test("an omitted locale lays out in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(date.segments()).toEqual([
        { type: "day", value: "03" },
        { type: "literal", value: "." },
        { type: "month", value: "02" },
        { type: "literal", value: "." },
        { type: "year", value: "2026" },
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("LocalDate.parseLocalized and tryParseLocalized", () => {
  const LOCALES = ["en-US", "en-GB", "de-DE", "ja-JP", "ar-EG", "he-IL", "hu-HU", "th-TH", "fa-IR"];
  const DATES = ["0001-01-01", "0987-06-05", "2024-02-29", "2026-02-03", "2026-10-01", "9999-12-31"];

  test.for(LOCALES.flatMap((tag) => DATES.map((iso) => [tag, iso] as const)))("round-trips %s through format in %s", ([tag, iso]) => {
    const locale = new Locale(tag);
    const formatted = LocalDate.parse(iso).format(locale);

    expect(LocalDate.parseLocalized(formatted, locale).toString()).toBe(iso);
    expect(LocalDate.tryParseLocalized(formatted, locale).value?.toString()).toBe(iso);
  });

  test("reads the fields in the locale's order", () => {
    expect(LocalDate.parseLocalized("02/03/2026", new Locale("en-US")).equals(LocalDate.of(2026, 2, 3))).toBe(true);
    expect(LocalDate.parseLocalized("02/03/2026", new Locale("en-GB")).equals(LocalDate.of(2026, 3, 2))).toBe(true);
  });

  test("reads ar-EG with or without its bidi marks", () => {
    const locale = new Locale("ar-EG");
    const expected = LocalDate.of(2026, 2, 3);

    expect(LocalDate.parseLocalized("03/02/2026", locale).equals(expected)).toBe(true);
    expect(LocalDate.parseLocalized("‏03‏/02؜/2026‎", locale).equals(expected)).toBe(true);
  });

  test("returns the value on success", () => {
    const result = LocalDate.tryParseLocalized("2/3/2026", new Locale("en-US"));

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalDate.of(2026, 2, 3))).toBe(true);
  });

  test.for([
    "02/30/2026",
    "02/29/2026",
    "13/01/2026",
    "00/10/2026",
    "01/00/2026",
    "01/32/2026",
    "01/01/0000",
    "01/01/26",
    "2026-01-01",
    "nope",
    "",
  ])("rejects %o in en-US", (str) => {
    const locale = new Locale("en-US");

    expect(LocalDate.tryParseLocalized(str, locale)).toEqual({ success: false });
    expect(() => LocalDate.parseLocalized(str, locale)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises, not InvalidDateTimeError", () => {
    try {
      LocalDate.parseLocalized("02/30/2026", new Locale("en-US"));
      expect.unreachable("LocalDate.parseLocalized accepted February 30");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
      expect(isInvalidDateTimeError(error)).toBe(false);
    }
  });

  test("quotes the input and names the locale in the message", () => {
    expect(() => LocalDate.parseLocalized("nope", new Locale("de-DE"))).toThrow('Cannot parse "nope" as a date in de-DE.');
  });

  test("an omitted locale reads in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(LocalDate.parseLocalized("03.02.2026").equals(LocalDate.of(2026, 2, 3))).toBe(true);
      expect(LocalDate.tryParseLocalized("03.02.2026").value?.equals(LocalDate.of(2026, 2, 3))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves parse and tryParse reading ISO 8601 only", () => {
    expect(LocalDate.tryParse("02/03/2026")).toEqual({ success: false });
    expect(LocalDate.parse("2026-02-03").equals(LocalDate.of(2026, 2, 3))).toBe(true);
  });
});

describe("The start of a LocalDate in a time zone", () => {
  /** A value's local date-time, offset and instant as plain strings and numbers, for one `toEqual`. */
  function zonedParts(value: ZonedDateTime): { local: string; offsetSeconds: number; instant: string } {
    return { local: value.toLocalDateTime().toString(), offsetSeconds: value.offsetSeconds, instant: value.toInstant().toString() };
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

  test("is midnight in a zone that reads it once, in the zone given", () => {
    const zone = ZoneId.of("Europe/Berlin");
    const value = date("2026-07-15").atStartOfDay(zone);

    expect(value.zone).toBe(zone);
    expect(zonedParts(value)).toEqual({ local: "2026-07-15T00:00", offsetSeconds: 7200, instant: "2026-07-14T22:00:00Z" });
  });

  test("is midnight under reject when the zone reads it once", () => {
    expect(zonedParts(date("2026-01-15").atStartOfDay(ZoneId.of("America/New_York"), { disambiguation: "reject" }))).toEqual({
      local: "2026-01-15T00:00",
      offsetSeconds: -18_000,
      instant: "2026-01-15T05:00:00Z",
    });
  });

  test("is the end of the gap when the zone skips midnight", () => {
    expect(zonedParts(date("2018-11-04").atStartOfDay(ZoneId.of("America/Sao_Paulo")))).toEqual({
      local: "2018-11-04T01:00",
      offsetSeconds: -7200,
      instant: "2018-11-04T03:00:00Z",
    });
  });

  test("is midnight of the next date the zone reads when the gap spans the whole date", () => {
    expect(zonedParts(date("2011-12-30").atStartOfDay(ZoneId.of("Pacific/Apia")))).toEqual({
      local: "2011-12-31T00:00",
      offsetSeconds: 50_400,
      instant: "2011-12-30T10:00:00Z",
    });
  });

  test("moves a skipped midnight back into the previous date under earlier", () => {
    expect(zonedParts(date("2018-11-04").atStartOfDay(ZoneId.of("America/Sao_Paulo"), { disambiguation: "earlier" }))).toEqual({
      local: "2018-11-03T23:00",
      offsetSeconds: -10_800,
      instant: "2018-11-04T02:00:00Z",
    });
  });

  test("is the earlier instant when the zone reads midnight twice", () => {
    expect(zonedParts(date("2015-11-01").atStartOfDay(ZoneId.of("America/Havana")))).toEqual({
      local: "2015-11-01T00:00",
      offsetSeconds: -14_400,
      instant: "2015-11-01T04:00:00Z",
    });
  });

  test("is the later instant of a midnight read twice under later", () => {
    expect(zonedParts(date("2015-11-01").atStartOfDay(ZoneId.of("America/Havana"), { disambiguation: "later" }))).toEqual({
      local: "2015-11-01T00:00",
      offsetSeconds: -18_000,
      instant: "2015-11-01T05:00:00Z",
    });
  });

  test.for([
    ["2018-11-04", "America/Sao_Paulo"],
    ["2015-11-01", "America/Havana"],
  ] as const)("throws ZoneResolutionError under reject when %s's midnight in %s is skipped or read twice", ([day, zone]) => {
    expect(isZoneResolutionError(thrown(() => date(day).atStartOfDay(ZoneId.of(zone), { disambiguation: "reject" })))).toBe(true);
  });
});
