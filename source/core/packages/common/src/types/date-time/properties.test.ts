import { describe, expect, test } from "vitest";
import { Locale } from "../../locale";
import {
  DateTimeParseError,
  Instant,
  InvalidDateTimeError,
  isDateTimeParseError,
  isInvalidDateTimeError,
  LocalDate,
  LocalDateTime,
  LocalTime,
  ZoneId,
} from "./index";
import { ZonedDateTime } from "./zoned-date-time";

const DATES = [
  "0001-01-01",
  "1900-03-01",
  "1970-01-01",
  "2000-02-29",
  "2023-02-28",
  "2024-02-28",
  "2024-02-29",
  "2024-12-31",
  "2026-10-01",
  "9999-12-31",
];
const TIMES = [
  "00:00",
  "00:01",
  "12:30",
  "23:59",
  "00:00:01",
  "14:30:05",
  "23:59:59",
  "00:00:00.001",
  "14:30:05.250",
  "23:59:59.999",
  "10:00:00.050",
];
const DATE_TIMES = DATES.flatMap((date) => TIMES.map((time) => `${date}T${time}`));
const AMOUNTS = [0, 1, 2, 7, 28, 29, 30, 31, 59, 60, 365, 366, 1461, 36524, 146097, 365000];

function throwsInvalid(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(isInvalidDateTimeError(thrown)).toBe(true);
  expect(thrown).toBeInstanceOf(InvalidDateTimeError);
}

function throwsParse(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(isDateTimeParseError(thrown)).toBe(true);
  expect(thrown).toBeInstanceOf(DateTimeParseError);
}

describe("ISO parse then format round-trips", () => {
  test.each(DATES)("LocalDate %s", (text) => {
    expect(LocalDate.parse(text).toString()).toBe(text);
  });

  test.each(TIMES)("LocalTime %s", (text) => {
    expect(LocalTime.parse(text).toString()).toBe(text);
  });

  test("LocalTime without seconds or fraction keeps the short form", () => {
    expect(LocalTime.parse("14:30:00").toString()).toBe("14:30");
    expect(LocalTime.parse("14:30:05.000").toString()).toBe("14:30:05");
  });

  test("LocalTime pads a short fraction as a decimal of a second", () => {
    expect(LocalTime.parse("14:30:05.5").toString()).toBe("14:30:05.500");
    expect(LocalTime.parse("14:30:05.05").toString()).toBe("14:30:05.050");
  });

  test.each(DATE_TIMES)("LocalDateTime %s", (text) => {
    expect(LocalDateTime.parse(text).toString()).toBe(text);
  });

  test("formatting then parsing yields an equal value", () => {
    const value = LocalDateTime.ofFields(2024, 2, 29, 23, 59, 59, 999);
    expect(LocalDateTime.parse(value.toString()).equals(value)).toBe(true);
  });
});

describe("ISO fractions of a second", () => {
  const FORMS = [
    "14:30",
    "14:30:05",
    "14:30:05.250",
    "14:30:05.000001",
    "14:30:05.123456",
    "14:30:05.000000001",
    "14:30:05.123456789",
    "00:00:00.999999999",
    "23:59:59.100",
  ];

  test.each(FORMS)("LocalTime %s round-trips", (text) => {
    const time = LocalTime.parse(text);
    expect(time.toString()).toBe(text);
    expect(LocalTime.parse(time.toString()).equals(time)).toBe(true);
  });

  test.each(FORMS)("LocalDateTime %s round-trips", (text) => {
    const value = LocalDateTime.parse(`2026-10-01T${text}`);
    expect(value.toString()).toBe(`2026-10-01T${text}`);
    expect(LocalDateTime.parse(value.toString()).equals(value)).toBe(true);
  });

  test.each([
    ["14:30:05.5", "14:30:05.500"],
    ["14:30:05.1234", "14:30:05.123400"],
    ["14:30:05.12", "14:30:05.120"],
    ["14:30:05.120000000", "14:30:05.120"],
    ["14:30:05.123000", "14:30:05.123"],
    ["14:30:05.0000010", "14:30:05.000001"],
    ["14:30:05.000000000", "14:30:05"],
    ["14:30:00.000000000", "14:30"],
  ])("a non-shortest fraction in %s normalises to %s", (text, expected) => {
    expect(LocalTime.parse(text).toString()).toBe(expected);
    expect(LocalDateTime.parse(`2026-10-01T${text}`).toString()).toBe(`2026-10-01T${expected}`);
  });

  test("a fraction is read as digits of a second and never rounded", () => {
    expect(LocalTime.parse("14:30:05.999999999").nanosecond).toBe(999_999_999);
    expect(LocalTime.parse("14:30:05.1234").nanosecond).toBe(123_400_000);
  });

  test("a fraction of ten digits is rejected", () => {
    throwsParse(() => LocalTime.parse("14:30:05.1234567890"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T14:30:05.1234567890"));
    expect(LocalTime.tryParse("14:30:05.1234567890")).toEqual({ success: false });
    expect(LocalDateTime.tryParse("2026-10-01T14:30:05.1234567890")).toEqual({ success: false });
  });

  test("a nanosecond out of range is rejected", () => {
    for (const nanosecond of [-1, 1_000_000_000, 1.5, Number.NaN]) {
      throwsInvalid(() => LocalTime.of(12, 0, 0, nanosecond));
      throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 12, 0, 0, nanosecond));
    }
  });
});

describe("plusDays(n).minusDays(n) is the identity", () => {
  const starts = ["2024-02-28", "2024-12-31", "2023-02-28", "2000-02-29", "1900-03-01", "2026-10-01", "2024-01-01"];

  test.each(starts)("LocalDate %s", (text) => {
    const start = LocalDate.parse(text);
    for (const amount of AMOUNTS) {
      expect(start.plusDays(amount).minusDays(amount).equals(start)).toBe(true);
      expect(start.minusDays(amount).plusDays(amount).equals(start)).toBe(true);
      expect(start.plusDays(-amount).minusDays(-amount).equals(start)).toBe(true);
    }
  });

  test.each(starts)("LocalDateTime %s keeps the time of day", (text) => {
    const start = LocalDateTime.parse(`${text}T13:45:10.123`);
    for (const amount of AMOUNTS) {
      expect(start.plusDays(amount).minusDays(amount).equals(start)).toBe(true);
    }
  });

  test("a single day crosses month, year and leap-day boundaries", () => {
    expect(LocalDate.parse("2024-02-28").plusDays(1).toString()).toBe("2024-02-29");
    expect(LocalDate.parse("2024-02-29").plusDays(1).toString()).toBe("2024-03-01");
    expect(LocalDate.parse("2023-02-28").plusDays(1).toString()).toBe("2023-03-01");
    expect(LocalDate.parse("2024-12-31").plusDays(1).toString()).toBe("2025-01-01");
    expect(LocalDate.parse("1900-03-01").minusDays(1).toString()).toBe("1900-02-28");
    expect(LocalDate.parse("2000-03-01").minusDays(1).toString()).toBe("2000-02-29");
  });
});

describe("compare agrees with equals", () => {
  const dates = DATES.map((text) => LocalDate.parse(text));
  const times = TIMES.map((text) => LocalTime.parse(text));
  const dateTimes = DATES.flatMap((date) =>
    ["00:00", "12:30:15.500", "23:59:59.999"].map((time) => LocalDateTime.parse(`${date}T${time}`)),
  );

  test("LocalDate", () => {
    for (const a of dates) {
      for (const b of dates) {
        expect(LocalDate.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDate.compare(a, b)) === -Math.sign(LocalDate.compare(b, a))).toBe(true);
      }
    }
  });

  test("LocalTime", () => {
    for (const a of times) {
      for (const b of times) {
        expect(LocalTime.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalTime.compare(a, b)) === -Math.sign(LocalTime.compare(b, a))).toBe(true);
      }
    }
  });

  test("date-times", () => {
    for (const a of dateTimes) {
      for (const b of dateTimes) {
        expect(LocalDateTime.compare(a, b) === 0).toBe(a.equals(b));
        expect(Math.sign(LocalDateTime.compare(a, b)) === -Math.sign(LocalDateTime.compare(b, a))).toBe(true);
      }
    }
  });

  test("a nanosecond-only difference orders the values and breaks equality", () => {
    const nanos = [0, 1, 999, 1_000, 999_999, 1_000_000, 123_456_789, 999_999_999];
    for (const a of nanos) {
      for (const b of nanos) {
        const timeA = LocalTime.of(14, 30, 5, a);
        const timeB = LocalTime.of(14, 30, 5, b);
        const valueA = LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, a);
        const valueB = LocalDateTime.ofFields(2026, 10, 1, 14, 30, 5, b);
        expect(Math.sign(LocalTime.compare(timeA, timeB))).toBe(Math.sign(a - b));
        expect(Math.sign(LocalDateTime.compare(valueA, valueB))).toBe(Math.sign(a - b));
        expect(timeA.equals(timeB)).toBe(a === b);
        expect(valueA.equals(valueB)).toBe(a === b);
      }
    }
  });

  test("a later second outranks an earlier nanosecond", () => {
    expect(LocalTime.compare(LocalTime.of(0, 0, 1, 0), LocalTime.of(0, 0, 0, 999_999_999))).toBeGreaterThan(0);
  });

  test("equal values built separately compare as zero", () => {
    expect(LocalDate.compare(LocalDate.of(2026, 10, 1), LocalDate.parse("2026-10-01"))).toBe(0);
    expect(LocalTime.compare(LocalTime.of(14, 30), LocalTime.parse("14:30:00.000"))).toBe(0);
    expect(LocalDateTime.compare(LocalDateTime.ofFields(2026, 10, 1, 14, 30), LocalDateTime.parse("2026-10-01T14:30"))).toBe(0);
  });

  test("ordering follows chronology", () => {
    const sorted = dates.map(String);
    expect([...dates].sort(LocalDate.compare).map(String)).toEqual(sorted);
    expect([...dates].reverse().sort(LocalDate.compare).map(String)).toEqual(sorted);
  });
});

describe("out-of-range fields are rejected", () => {
  test("by of(...) with InvalidDateTimeError", () => {
    throwsInvalid(() => LocalDate.of(2026, 2, 30));
    throwsInvalid(() => LocalDate.of(2023, 2, 29));
    throwsInvalid(() => LocalDate.of(2026, 13, 1));
    throwsInvalid(() => LocalDate.of(2026, 10, 0));
    throwsInvalid(() => LocalTime.of(24, 0));
    throwsInvalid(() => LocalTime.of(12, 60));
    throwsInvalid(() => LocalTime.of(12, 0, 60));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 2, 30, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 13, 1, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 0, 10, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 24, 0));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 10, 60));
    throwsInvalid(() => LocalDateTime.ofFields(2026, 10, 1, 10, 0, 60));
  });

  test("by parse with DateTimeParseError", () => {
    throwsParse(() => LocalDate.parse("2026-02-30"));
    throwsParse(() => LocalDate.parse("2023-02-29"));
    throwsParse(() => LocalDate.parse("2026-13-01"));
    throwsParse(() => LocalDate.parse("2026-10-00"));
    throwsParse(() => LocalTime.parse("24:00"));
    throwsParse(() => LocalTime.parse("12:60"));
    throwsParse(() => LocalTime.parse("12:00:60"));
    throwsParse(() => LocalDateTime.parse("2026-02-30T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-13-01T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-00T10:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T24:00"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T10:60"));
    throwsParse(() => LocalDateTime.parse("2026-10-01T10:00:60"));
  });

  test("by tryParse without throwing", () => {
    expect(LocalDate.tryParse("2026-02-30")).toEqual({ success: false });
    expect(LocalTime.tryParse("24:00")).toEqual({ success: false });
    expect(LocalDateTime.tryParse("2026-10-01T10:60")).toEqual({ success: false });
  });
});

describe("plusMonths and minusMonths clamp the day", () => {
  test.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2023-01-31", 1, "2023-02-28"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2023-03-31", -1, "2023-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", -12, "2023-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
    ["2024-01-31", 3, "2024-04-30"],
    ["2024-10-31", 4, "2025-02-28"],
    ["2024-12-31", 2, "2025-02-28"],
    ["2024-01-15", -1, "2023-12-15"],
  ] as const)("%s plus %i months is %s", (start, months, expected) => {
    expect(LocalDate.parse(start).plusMonths(months).toString()).toBe(expected);
    expect(LocalDate.parse(start).minusMonths(-months).toString()).toBe(expected);
    expect(LocalDateTime.parse(`${start}T08:15`).plusMonths(months).toString()).toBe(`${expected}T08:15`);
  });
});

describe("dayOfWeek agrees with known dates", () => {
  test.each([
    ["2026-10-01", 4],
    ["1970-01-01", 4],
    ["2000-01-01", 6],
    ["2024-02-29", 4],
    ["0001-01-01", 1],
    ["9999-12-31", 5],
    ["2026-10-04", 7],
  ] as const)("%s is ISO day %i", (text, expected) => {
    expect(LocalDate.parse(text).dayOfWeek).toBe(expected);
    expect(LocalDateTime.parse(`${text}T12:00`).dayOfWeek).toBe(expected);
  });

  test("seven days later is the same day of the week", () => {
    const start = LocalDate.parse("2024-02-26");
    for (let offset = 0; offset < 400; offset++) {
      const date = start.plusDays(offset);
      expect(date.plusDays(7).dayOfWeek).toBe(date.dayOfWeek);
    }
  });
});

const LOCALES = [
  "en-US",
  "en-GB",
  "de-DE",
  "fr-FR",
  "ja-JP",
  "ko-KR",
  "ar-EG",
  "he-IL",
  "hu-HU",
  "th-TH",
  "fa-IR",
  "en-US-u-hc-h23",
  "en-GB-u-hc-h12",
].map((tag) => new Locale(tag));

describe("localized format then parse round-trips", () => {
  describe.each(LOCALES.map((locale) => [locale.tag, locale] as const))("%s", (_tag, locale) => {
    test.each(DATES)("LocalDate %s", (text) => {
      const date = LocalDate.parse(text);
      const result = LocalDate.tryParseLocalized(date.format(locale), locale);
      expect(result.success).toBe(true);
      expect(result.value?.toString()).toBe(text);
    });

    test("a time with a fraction of a second parses back with zero second and nanosecond", () => {
      const time = LocalTime.parse("14:30:05.123456789");
      const parsed = LocalTime.parseLocalized(time.format(locale), locale);
      expect(parsed.hour).toBe(14);
      expect(parsed.minute).toBe(30);
      expect(parsed.second).toBe(0);
      expect(parsed.nanosecond).toBe(0);
      const value = LocalDateTime.parse("2026-10-01T14:30:05.123456789");
      const parsedValue = LocalDateTime.parseLocalized(value.format(locale), locale);
      expect(parsedValue.toString()).toBe("2026-10-01T14:30");
    });

    test("LocalTime keeps hour and minute and zeroes the rest", () => {
      for (const text of TIMES) {
        const time = LocalTime.parse(text);
        const result = LocalTime.tryParseLocalized(time.format(locale), locale);
        expect(result.success).toBe(true);
        expect(result.value?.equals(LocalTime.of(time.hour, time.minute))).toBe(true);
      }
    });

    test("LocalDateTime keeps the date, hour and minute and zeroes the rest", () => {
      for (const text of DATE_TIMES) {
        const value = LocalDateTime.parse(text);
        const result = LocalDateTime.tryParseLocalized(value.format(locale), locale);
        expect(result.success).toBe(true);
        const { date, time } = value;
        expect(result.value?.equals(LocalDateTime.ofFields(date.year, date.month, date.day, time.hour, time.minute))).toBe(true);
      }
    });
  });
});

describe("LocalDate segments", () => {
  test("joined values equal the formatted date for every locale", () => {
    for (const locale of LOCALES) {
      for (const text of DATES) {
        const date = LocalDate.parse(text);
        expect(
          date
            .segments(locale)
            .map((segment) => segment.value)
            .join(""),
        ).toBe(date.format(locale));
      }
    }
  });

  test("field order follows the locale", () => {
    const date = LocalDate.of(2026, 10, 1);
    const order = (tag: string) =>
      date
        .segments(new Locale(tag))
        .map((segment) => segment.type)
        .filter((type) => type !== "literal");
    expect(order("en-US")).toEqual(["month", "day", "year"]);
    expect(order("en-GB")).toEqual(["day", "month", "year"]);
    expect(order("ja-JP")).toEqual(["year", "month", "day"]);
  });
});

describe("well-shaped but impossible localized strings are rejected", () => {
  const enUS = new Locale("en-US");
  const enGB = new Locale("en-GB");
  const deDE = new Locale("de-DE");

  test.each([
    ["02/30/2026", enUS],
    ["30/02/2026", enGB],
    ["31.04.2026", deDE],
    ["29/02/2023", enGB],
  ] as const)("LocalDate %s", (text, locale) => {
    expect(LocalDate.tryParseLocalized(text, locale)).toEqual({ success: false });
    throwsParse(() => LocalDate.parseLocalized(text, locale));
  });

  test.each([
    ["13:00 PM", enUS],
    ["00:30 AM", enUS],
    ["24:00", enGB],
    ["12:60", enGB],
  ] as const)("LocalTime %s", (text, locale) => {
    expect(LocalTime.tryParseLocalized(text, locale)).toEqual({ success: false });
    throwsParse(() => LocalTime.parseLocalized(text, locale));
  });

  test("LocalDateTime with an impossible date", () => {
    const text = LocalDateTime.ofFields(2026, 2, 28, 10, 0).format(enUS).replace("28", "30");
    expect(text).toContain("30");
    expect(LocalDateTime.tryParseLocalized(text, enUS)).toEqual({ success: false });
    throwsParse(() => LocalDateTime.parseLocalized(text, enUS));
  });

  test("LocalDateTime with an impossible time", () => {
    const text = LocalDateTime.ofFields(2026, 2, 28, 10, 0).format(enUS).replace("10", "13");
    expect(text).toContain("13");
    expect(LocalDateTime.tryParseLocalized(text, enUS)).toEqual({ success: false });
    throwsParse(() => LocalDateTime.parseLocalized(text, enUS));
  });
});

describe("12-hour and 24-hour clocks", () => {
  const enUS = new Locale("en-US");

  test("12-hour midnight and noon format with hour 12 and an AM or PM marker", () => {
    expect(LocalTime.of(0, 0).format(enUS)).toMatch(/^0?12:00\s?AM$/);
    expect(LocalTime.of(12, 0).format(enUS)).toMatch(/^0?12:00\s?PM$/);
  });

  test("12-hour midnight and noon parse back to hours 0 and 12", () => {
    expect(LocalTime.parseLocalized(LocalTime.of(0, 0).format(enUS), enUS).hour).toBe(0);
    expect(LocalTime.parseLocalized(LocalTime.of(12, 0).format(enUS), enUS).hour).toBe(12);
  });

  test.each(["en-GB", "en-US-u-hc-h23"])("%s never prints hour 24", (tag) => {
    const locale = new Locale(tag);
    expect(LocalTime.of(0, 0).format(locale)).toMatch(/^00:00/);
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute++) {
        const time = LocalTime.of(hour, minute);
        const text = time.format(locale);
        expect(text.startsWith("24")).toBe(false);
        expect(LocalTime.parseLocalized(text, locale).equals(time)).toBe(true);
      }
    }
  });
});

/**
 * A transition: the instant `at` a zone's offset moves from `offsetBefore` to `offsetAfter`, in
 * seconds, and the local window `[windowStart, windowEnd)` it skips (a gap) or reads twice (an
 * overlap).
 */
interface ZoneTransition {
  readonly zone: string;
  readonly kind: "gap" | "overlap";
  readonly at: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly offsetBefore: number;
  readonly offsetAfter: number;
}

const ZONE_TRANSITIONS: readonly ZoneTransition[] = [
  {
    zone: "Europe/Berlin",
    kind: "gap",
    at: "2026-03-29T01:00:00Z",
    windowStart: "2026-03-29T02:00",
    windowEnd: "2026-03-29T03:00",
    offsetBefore: 3600,
    offsetAfter: 7200,
  },
  {
    zone: "Europe/Berlin",
    kind: "overlap",
    at: "2026-10-25T01:00:00Z",
    windowStart: "2026-10-25T02:00",
    windowEnd: "2026-10-25T03:00",
    offsetBefore: 7200,
    offsetAfter: 3600,
  },
  {
    zone: "America/New_York",
    kind: "gap",
    at: "2026-03-08T07:00:00Z",
    windowStart: "2026-03-08T02:00",
    windowEnd: "2026-03-08T03:00",
    offsetBefore: -18_000,
    offsetAfter: -14_400,
  },
  {
    zone: "America/New_York",
    kind: "overlap",
    at: "2026-11-01T06:00:00Z",
    windowStart: "2026-11-01T01:00",
    windowEnd: "2026-11-01T02:00",
    offsetBefore: -14_400,
    offsetAfter: -18_000,
  },
  {
    zone: "Australia/Lord_Howe",
    kind: "overlap",
    at: "2026-04-04T15:00:00Z",
    windowStart: "2026-04-05T01:30",
    windowEnd: "2026-04-05T02:00",
    offsetBefore: 39_600,
    offsetAfter: 37_800,
  },
  {
    zone: "Australia/Lord_Howe",
    kind: "gap",
    at: "2026-10-03T15:30:00Z",
    windowStart: "2026-10-04T02:00",
    windowEnd: "2026-10-04T02:30",
    offsetBefore: 37_800,
    offsetAfter: 39_600,
  },
  {
    zone: "Pacific/Apia",
    kind: "gap",
    at: "2011-12-30T10:00:00Z",
    windowStart: "2011-12-30T00:00",
    windowEnd: "2011-12-31T00:00",
    offsetBefore: -36_000,
    offsetAfter: 50_400,
  },
];

const ZONE_TRANSITION_ROWS = ZONE_TRANSITIONS.map((transition) => ({
  ...transition,
  label: `${transition.zone} ${transition.kind} at ${transition.at}`,
}));

/** The local date-time a wall clock at the fixed offset `offsetSeconds` shows at `instant`. */
function wallClockAt(instant: Instant, offsetSeconds: number): LocalDateTime {
  return LocalDateTime.parse(instant.plusSeconds(offsetSeconds).toString().slice(0, -1));
}

/** The instant `local` names when read at the fixed offset `offsetSeconds`. */
function instantAtOffset(local: LocalDateTime, offsetSeconds: number): Instant {
  const { date, time } = local;
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const utc = `${date}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}.${pad(time.nanosecond, 9)}Z`;
  return Instant.parse(utc).minusSeconds(offsetSeconds);
}

/** Elapsed nanoseconds from `a` to `b`, exact while under 2^53. */
function elapsedNanos(a: Instant, b: Instant): number {
  return (b.toEpochSecond() - a.toEpochSecond()) * 1_000_000_000 + (b.nanosecond - a.nanosecond);
}

/** A deterministic sequence of integers in `[0, bound)`, a linear congruential generator seeded with `seed`. */
function spread(seed: number, count: number, bound: number): number[] {
  const values: number[] = [];
  let state = seed;
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    values.push(state % bound);
  }
  return values;
}

/**
 * Instants around a transition: every minute for two hours either side, every second for two
 * minutes either side, every nanosecond for five either side, and a deterministic spread over two
 * days either side with arbitrary nanoseconds.
 */
function instantsAround(transition: ZoneTransition): Instant[] {
  const at = Instant.parse(transition.at);
  const instants: Instant[] = [];
  for (let minute = -120; minute <= 120; minute++) {
    instants.push(at.plusSeconds(minute * 60));
  }
  for (let second = -120; second <= 120; second++) {
    instants.push(at.plusSeconds(second).plusNanos(second * 7_919));
  }
  for (let nano = -5; nano <= 5; nano++) {
    instants.push(at.plusNanos(nano));
  }
  const seconds = spread(transition.offsetAfter - transition.offsetBefore, 200, 4 * 86_400);
  const nanos = spread(transition.offsetBefore, 200, 1_000_000_000);
  seconds.forEach((second, index) => {
    instants.push(at.plusSeconds(second - 2 * 86_400).plusNanos(nanos[index] as number));
  });
  return instants;
}

describe("LocalDateTime atZone then toLocalDateTime", () => {
  test.for(ZONE_TRANSITION_ROWS)("is the identity outside the window and settles it inside, around $label", (transition) => {
    const zone = ZoneId.of(transition.zone);
    const windowStart = LocalDateTime.parse(transition.windowStart);
    const windowEnd = LocalDateTime.parse(transition.windowEnd);
    const shift = transition.offsetAfter - transition.offsetBefore;
    const first = instantAtOffset(windowStart, 0).minusSeconds(3 * 3600);
    const last = instantAtOffset(windowEnd, 0).plusSeconds(3 * 3600);
    let inside = 0;
    for (let step = 0; Instant.compare(first.plusSeconds(step * 60), last) <= 0; step++) {
      const local = wallClockAt(first.plusSeconds(step * 60).plusNanos(step * 104_729), 0);
      const value = local.atZone(zone);
      const beforeWindow = LocalDateTime.compare(local, windowStart) < 0;
      const afterWindow = LocalDateTime.compare(local, windowEnd) >= 0;
      if (beforeWindow || afterWindow) {
        expect(value.toLocalDateTime().equals(local)).toBe(true);
        expect(value.offsetSeconds).toBe(beforeWindow ? transition.offsetBefore : transition.offsetAfter);
        continue;
      }
      inside++;
      if (transition.kind === "gap") {
        const shifted = wallClockAt(instantAtOffset(local, 0).plusSeconds(shift), 0);
        expect(value.toLocalDateTime().equals(shifted)).toBe(true);
        expect(value.offsetSeconds).toBe(transition.offsetAfter);
      } else {
        expect(value.toLocalDateTime().equals(local)).toBe(true);
        expect(value.offsetSeconds).toBe(transition.offsetBefore);
      }
    }
    expect(inside).toBeGreaterThan(0);
  });
});

describe("Instant atZone then toInstant", () => {
  test.for(ZONE_TRANSITION_ROWS)("is the identity for every instant sampled around $label", (transition) => {
    const zone = ZoneId.of(transition.zone);
    const at = Instant.parse(transition.at);
    for (const instant of instantsAround(transition)) {
      const value = instant.atZone(zone);
      expect(value.toInstant().equals(instant)).toBe(true);
      expect(value.offsetSeconds).toBe(Instant.compare(instant, at) < 0 ? transition.offsetBefore : transition.offsetAfter);
      expect(value.toLocalDateTime().equals(wallClockAt(instant, value.offsetSeconds))).toBe(true);
    }
  });
});

describe("ZonedDateTime toString then parse", () => {
  test.for(ZONE_TRANSITION_ROWS)("round-trips every instant sampled around $label", (transition) => {
    const zone = ZoneId.of(transition.zone);
    for (const instant of instantsAround(transition)) {
      const value = instant.atZone(zone);
      const text = value.toString();
      const parsed = ZonedDateTime.parse(text);
      expect(parsed.equals(value)).toBe(true);
      expect(parsed.offsetSeconds).toBe(value.offsetSeconds);
      expect(parsed.toString()).toBe(text);
    }
  });

  test.for(ZONE_TRANSITION_ROWS.filter((transition) => transition.kind === "overlap"))(
    "keeps both instants of the overlap apart around $label",
    (transition) => {
      const zone = ZoneId.of(transition.zone);
      const local = LocalDateTime.parse(transition.windowStart);
      const earlier = local.atZone(zone, { disambiguation: "earlier" });
      const later = local.atZone(zone, { disambiguation: "later" });
      expect(earlier.offsetSeconds).toBe(transition.offsetBefore);
      expect(later.offsetSeconds).toBe(transition.offsetAfter);
      expect(elapsedNanos(earlier.toInstant(), later.toInstant())).toBe((transition.offsetBefore - transition.offsetAfter) * 1_000_000_000);
      for (const value of [earlier, later]) {
        const parsed = ZonedDateTime.parse(value.toString());
        expect(parsed.toInstant().equals(value.toInstant())).toBe(true);
        expect(parsed.toLocalDateTime().equals(local)).toBe(true);
        expect(parsed.toString()).toBe(value.toString());
      }
      expect(earlier.toString()).not.toBe(later.toString());
    },
  );
});

describe("calendar days and elapsed hours across transitions", () => {
  test.for([
    ["Europe/Berlin", "2026-03-28T12:00", 1, 23],
    ["Europe/Berlin", "2026-10-24T12:00", 1, 25],
    ["America/New_York", "2026-03-07T12:00", 1, 23],
    ["America/New_York", "2026-10-31T12:00", 1, 25],
    ["Australia/Lord_Howe", "2026-04-04T12:00", 1, 24.5],
    ["Australia/Lord_Howe", "2026-10-03T12:00", 1, 23.5],
    ["Pacific/Apia", "2011-12-29T12:00", 2, 24],
    ["Europe/Berlin", "2026-07-15T12:00", 1, 24],
  ] as const)("in %s, %s plus %i days is %d elapsed hours", ([zone, start, days, hours]) => {
    const value = LocalDateTime.parse(start).atZone(ZoneId.of(zone));
    const later = value.plusDays(days);
    expect(elapsedNanos(value.toInstant(), later.toInstant())).toBe(hours * 3_600_000_000_000);
    expect(later.toLocalDateTime().equals(LocalDateTime.parse(start).plusDays(days))).toBe(true);
    expect(later.minusDays(days).equals(value)).toBe(true);
  });

  test.for(ZONE_TRANSITION_ROWS)("plusHours(24) is 24 elapsed hours from every instant sampled around $label", (transition) => {
    const zone = ZoneId.of(transition.zone);
    const at = Instant.parse(transition.at);
    for (let step = -60; step <= 12; step++) {
      const value = at
        .plusSeconds(step * 1800)
        .plusNanos(Math.abs(step) * 31_337)
        .atZone(zone);
      const later = value.plusHours(24);
      expect(elapsedNanos(value.toInstant(), later.toInstant())).toBe(24 * 3_600_000_000_000);
      expect(later.minusHours(24).equals(value)).toBe(true);
    }
  });
});

describe("LocalDate atStartOfDay", () => {
  /** Dates two days either side of every transition, plus the dates whose midnight a zone skips. */
  const cases = [
    ...ZONE_TRANSITIONS.flatMap((transition) =>
      [-2, -1, 0, 1, 2].map(
        (days) => [transition.zone, LocalDate.parse(transition.windowStart.slice(0, 10)).plusDays(days).toString()] as const,
      ),
    ).filter(([zone, date]) => !(zone === "Pacific/Apia" && date === "2011-12-30")),
    ["America/Sao_Paulo", "2018-11-04"] as const,
    ["Asia/Tehran", "2021-03-22"] as const,
  ];

  test.for(cases)("is the first instant of %s %s", ([zoneName, text]) => {
    const zone = ZoneId.of(zoneName);
    const date = LocalDate.parse(text);
    const start = date.atStartOfDay(zone);
    expect(start.toLocalDateTime().date.equals(date)).toBe(true);
    const previous = start.toInstant().minusNanos(1).atZone(zone).toLocalDateTime().date;
    expect(LocalDate.compare(previous, date)).toBeLessThan(0);
  });

  test.for([
    ["America/Sao_Paulo", "2018-11-04", "2018-11-04T01:00-02:00"],
    ["Asia/Tehran", "2021-03-22", "2021-03-22T01:00+04:30"],
    ["Europe/Berlin", "2026-03-29", "2026-03-29T00:00+01:00"],
    ["Pacific/Apia", "2011-12-31", "2011-12-31T00:00+14:00"],
  ] as const)("in %s, %s starts at %s", ([zoneName, text, expected]) => {
    const zone = ZoneId.of(zoneName);
    expect(LocalDate.parse(text).atStartOfDay(zone).toString()).toBe(`${expected}[${zone.id}]`);
  });

  test("a date a zone skips whole starts on the next date", () => {
    const zone = ZoneId.of("Pacific/Apia");
    expect(LocalDate.parse("2011-12-30").atStartOfDay(zone).toString()).toBe(`2011-12-31T00:00+14:00[${zone.id}]`);
  });
});
