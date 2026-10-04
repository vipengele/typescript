import { describe, expect, test } from "vitest";
import { Locale } from "../../locale";
import {
  dateSegments,
  formatDate,
  formatDateTime,
  formatTime,
  layoutDateTime,
  parseDate,
  parseDateTime,
  parseTime,
  resolveDatePattern,
  resolveDateTimeLayout,
  resolveTimePattern,
  stripBidiMarks,
} from "./locale-format";

const enUS = new Locale("en-US");
const deDE = new Locale("de-DE");
const jaJP = new Locale("ja-JP");
const arEG = new Locale("ar-EG");
const huHU = new Locale("hu-HU");
const enGB = new Locale("en-GB");
const koKR = new Locale("ko-KR");
const vi = new Locale("vi");
const enUS24 = new Locale("en-US-u-hc-h23");
const enGB12 = new Locale("en-GB-u-hc-h12");

/** `str` with every whitespace character as a regular space, so ICU's U+202F compares equal to it. */
const spaced = (str: string): string => str.replace(/\s/g, " ");

/**
 * `Intl`'s own spelling, joined from `formatToParts`: V8's `format` replaces U+202F with a regular
 * space, which `formatToParts` keeps.
 */
const intlParts = (tag: string, options: Intl.DateTimeFormatOptions, at: number): string =>
  new Intl.DateTimeFormat(tag, { calendar: "gregory", numberingSystem: "latn", timeZone: "UTC", ...options })
    .formatToParts(at)
    .map((part) => part.value)
    .join("");

describe("resolveDatePattern", () => {
  test("en-US writes month, day, year between slashes", () => {
    expect(resolveDatePattern(enUS)).toEqual({ fields: ["month", "day", "year"], literals: ["", "/", "/", ""] });
  });

  test("de-DE writes day, month, year between full stops", () => {
    expect(resolveDatePattern(deDE)).toEqual({ fields: ["day", "month", "year"], literals: ["", ".", ".", ""] });
  });

  test("ja-JP writes year, month, day between slashes", () => {
    expect(resolveDatePattern(jaJP)).toEqual({ fields: ["year", "month", "day"], literals: ["", "/", "/", ""] });
  });

  test("hu-HU keeps the text after the last field", () => {
    const { fields, literals } = resolveDatePattern(huHU);

    expect(fields).toEqual(["year", "month", "day"]);
    expect(literals.at(-1)).toBe(".");
  });

  test("ar-EG separators read as slashes once bidi marks are removed", () => {
    const { fields, literals } = resolveDatePattern(arEG);

    expect(fields).toEqual(["day", "month", "year"]);
    expect(literals.map(stripBidiMarks)).toEqual(["", "/", "/", ""]);
  });

  test("two Locale instances for the same canonical tag share one cached pattern", () => {
    expect(resolveDatePattern(new Locale("en-us"))).toBe(resolveDatePattern(enUS));
  });
});

describe("stripBidiMarks", () => {
  test("removes U+200E, U+200F and U+061C wherever they sit", () => {
    expect(stripBidiMarks("‎03‏/02؜/2026‏")).toBe("03/02/2026");
  });

  test("leaves every other character in place", () => {
    expect(stripBidiMarks("2026. 02. 03​")).toBe("2026. 02. 03​");
  });
});

describe("dateSegments", () => {
  const date = { year: 2026, month: 2, day: 3 };

  test("lays the fields out in the locale's order with the literals between them", () => {
    expect(dateSegments(date, enUS)).toEqual([
      { type: "month", value: "02" },
      { type: "literal", value: "/" },
      { type: "day", value: "03" },
      { type: "literal", value: "/" },
      { type: "year", value: "2026" },
    ]);
  });

  test("pads the year to four digits and month and day to two", () => {
    expect(dateSegments({ year: 5, month: 6, day: 7 }, jaJP)).toEqual([
      { type: "year", value: "0005" },
      { type: "literal", value: "/" },
      { type: "month", value: "06" },
      { type: "literal", value: "/" },
      { type: "day", value: "07" },
    ]);
  });

  test("omits an empty literal and keeps a non-empty one in the same pattern", () => {
    const { literals } = resolveDatePattern(huHU);

    expect(literals[0]).toBe("");
    expect(dateSegments(date, huHU)).toEqual([
      { type: "year", value: "2026" },
      { type: "literal", value: literals[1] },
      { type: "month", value: "02" },
      { type: "literal", value: literals[2] },
      { type: "day", value: "03" },
      { type: "literal", value: "." },
    ]);
  });

  test("keeps bidi marks in the literals", () => {
    const { literals } = resolveDatePattern(arEG);
    const segments = dateSegments(date, arEG).filter((segment) => segment.type === "literal");

    expect(segments.map((segment) => segment.value)).toEqual(literals.filter((literal) => literal !== ""));
  });

  test("joins to formatDate's output", () => {
    expect(
      dateSegments(date, arEG)
        .map((segment) => segment.value)
        .join(""),
    ).toBe(formatDate(date, arEG));
  });
});

describe("formatDate", () => {
  test("pads the year to four digits and month and day to two", () => {
    expect(formatDate({ year: 5, month: 6, day: 7 }, enUS)).toBe("06/07/0005");
  });

  test("leaves fields that already fill their width unchanged", () => {
    expect(formatDate({ year: 2026, month: 12, day: 31 }, deDE)).toBe("31.12.2026");
  });

  test("writes the literals before, between and after the fields", () => {
    const { literals } = resolveDatePattern(huHU);

    expect(formatDate({ year: 2026, month: 2, day: 3 }, huHU)).toBe(`${literals[0]}2026${literals[1]}02${literals[2]}03${literals[3]}`);
  });

  test("counts years in the Gregorian calendar whatever the locale's default calendar", () => {
    expect(stripBidiMarks(formatDate({ year: 2026, month: 2, day: 3 }, new Locale("th-TH")))).toContain("2026");
    expect(stripBidiMarks(formatDate({ year: 2026, month: 2, day: 3 }, new Locale("fa-IR")))).toContain("2026");
  });
});

describe("parseDate", () => {
  test("assigns each number to the field the locale places there", () => {
    expect(parseDate("02/03/2026", enUS)).toEqual({ year: 2026, month: 2, day: 3 });
    expect(parseDate("02.03.2026", deDE)).toEqual({ year: 2026, month: 3, day: 2 });
    expect(parseDate("2026/02/03", jaJP)).toEqual({ year: 2026, month: 2, day: 3 });
  });

  test("accepts unpadded month and day", () => {
    expect(parseDate("2/3/2026", enUS)).toEqual({ year: 2026, month: 2, day: 3 });
  });

  test("does not check the fields against the calendar", () => {
    expect(parseDate("02/30/2026", enUS)).toEqual({ year: 2026, month: 2, day: 30 });
  });

  test("ignores whitespace around the date", () => {
    expect(parseDate(" \t02/03/2026  ", enUS)).toEqual({ year: 2026, month: 2, day: 3 });
  });

  test("ignores bidi marks, present or absent", () => {
    const expected = { year: 2026, month: 2, day: 3 };

    expect(parseDate("03/02/2026", arEG)).toEqual(expected);
    expect(parseDate("03‏/02‏/2026", arEG)).toEqual(expected);
    expect(parseDate("‎03؜/02/2026‎", arEG)).toEqual(expected);
    expect(parseDate("02‎/03/2026", enUS)).toEqual(expected);
  });

  test("requires the text after the last field", () => {
    expect(parseDate("2026. 02. 03.", huHU)).toEqual({ year: 2026, month: 2, day: 3 });
    expect(parseDate("2026. 02. 03", huHU)).toBeUndefined();
  });

  test.for([
    ["02/03/26", "a two-digit year"],
    ["02/03/026", "a three-digit year"],
    ["02/03/12026", "a five-digit year"],
    ["002/03/2026", "a three-digit month"],
    ["02/003/2026", "a three-digit day"],
    ["/03/2026", "a missing month"],
    ["02x03x2026", "a separator that is not the locale's"],
    ["02.03.2026", "another locale's separator"],
    ["02 / 03 / 2026", "whitespace inside the date"],
    ["x02/03/2026", "text before the date"],
    ["02/03/2026x", "text after the date"],
    ["2026-02-03", "ISO 8601 form"],
    ["٠٢/٠٣/٢٠٢٦", "Arabic-Indic digits"],
    ["", "an empty string"],
  ])("rejects %o, %s, in en-US", ([str]) => {
    expect(parseDate(str as string, enUS)).toBeUndefined();
  });

  test("treats the locale's separator as itself, not as a pattern", () => {
    expect(parseDate("03x02x2026", deDE)).toBeUndefined();
  });
});

describe("resolveTimePattern", () => {
  test("en-US writes a 12-hour clock with the day period after the minute", () => {
    const { twelveHour, fields, literals, am, pm } = resolveTimePattern(enUS);

    expect(twelveHour).toBe(true);
    expect(fields).toEqual(["hour", "minute", "dayPeriod"]);
    expect(literals.map(spaced)).toEqual(["", ":", " ", ""]);
    expect([am, pm]).toEqual(["AM", "PM"]);
  });

  test("de-DE writes a 24-hour clock with no day period", () => {
    expect(resolveTimePattern(deDE)).toEqual({ twelveHour: false, fields: ["hour", "minute"], literals: ["", ":", ""], am: "", pm: "" });
  });

  test("ko-KR writes the day period before the hour", () => {
    const { fields, am, pm } = resolveTimePattern(koKR);

    expect(fields).toEqual(["dayPeriod", "hour", "minute"]);
    expect([am, pm]).toEqual(["오전", "오후"]);
  });

  test("follows an hour cycle the tag spells out", () => {
    expect(resolveTimePattern(enUS24).twelveHour).toBe(false);
    expect(resolveTimePattern(enGB12).twelveHour).toBe(true);
    expect(resolveTimePattern(new Locale("ja-JP-u-hc-h11")).twelveHour).toBe(true);
    expect(resolveTimePattern(new Locale("en-US-u-hc-h24")).twelveHour).toBe(false);
  });

  test("two Locale instances for the same canonical tag share one cached pattern", () => {
    expect(resolveTimePattern(new Locale("en-us"))).toBe(resolveTimePattern(enUS));
  });

  test("a tag that changes only the hour cycle gets its own pattern", () => {
    expect(resolveTimePattern(enUS24)).not.toBe(resolveTimePattern(enUS));
  });
});

describe("formatTime", () => {
  test.for([
    [0, 0, "12:00 AM"],
    [0, 30, "12:30 AM"],
    [1, 5, "01:05 AM"],
    [11, 59, "11:59 AM"],
    [12, 0, "12:00 PM"],
    [12, 30, "12:30 PM"],
    [13, 5, "01:05 PM"],
    [23, 59, "11:59 PM"],
  ] as const)("writes %d:%d on en-US's 12-hour clock as %s", ([hour, minute, expected]) => {
    expect(spaced(formatTime({ hour, minute }, enUS))).toBe(expected);
  });

  test.for([
    [0, 0, "00:00"],
    [0, 30, "00:30"],
    [1, 5, "01:05"],
    [12, 0, "12:00"],
    [12, 30, "12:30"],
    [23, 59, "23:59"],
  ] as const)("writes %d:%d on de-DE's 24-hour clock as %s", ([hour, minute, expected]) => {
    expect(formatTime({ hour, minute }, deDE)).toBe(expected);
  });

  test("writes the day period where the locale places it", () => {
    expect(spaced(formatTime({ hour: 9, minute: 5 }, koKR))).toBe("오전 09:05");
    expect(spaced(formatTime({ hour: 21, minute: 5 }, koKR))).toBe("오후 09:05");
  });

  test("writes midnight as 00:00 on an h24 locale and 12:00 on an h11 one", () => {
    expect(formatTime({ hour: 0, minute: 0 }, new Locale("en-US-u-hc-h24"))).toBe("00:00");
    expect(formatTime({ hour: 0, minute: 0 }, new Locale("ja-JP-u-hc-h11"))).toBe("午前12:00");
  });

  test.for(["en-US", "en-GB", "de-DE", "ja-JP", "ar-EG", "he-IL", "fr-FR", "ko-KR", "en-GB-u-hc-h12", "en-US-u-hc-h23"])(
    "matches Intl's own spelling in %s",
    (tag) => {
      const locale = new Locale(tag);
      const hourCycle = locale.uses24Hour ? "h23" : "h12";

      for (const [hour, minute] of [
        [0, 30],
        [9, 5],
        [12, 0],
        [23, 59],
      ] as const) {
        expect(formatTime({ hour, minute }, locale)).toBe(
          intlParts(tag, { hour: "2-digit", minute: "2-digit", hourCycle }, Date.UTC(2026, 1, 3, hour, minute)),
        );
      }
    },
  );
});

describe("parseTime", () => {
  test.for([
    ["12:00 AM", 0, 0],
    ["12:30 AM", 0, 30],
    ["01:05 AM", 1, 5],
    ["11:59 AM", 11, 59],
    ["12:00 PM", 12, 0],
    ["12:30 PM", 12, 30],
    ["01:05 PM", 13, 5],
    ["11:59 PM", 23, 59],
  ] as const)("reads %s on en-US's 12-hour clock as %d:%d", ([str, hour, minute]) => {
    expect(parseTime(str, enUS)).toEqual({ hour, minute });
  });

  test("reads an unpadded hour", () => {
    expect(parseTime("1:05 PM", enUS)).toEqual({ hour: 13, minute: 5 });
    expect(parseTime("9:05", deDE)).toEqual({ hour: 9, minute: 5 });
  });

  test("reads the day period in any letter case", () => {
    expect(parseTime("01:05 pm", enUS)).toEqual({ hour: 13, minute: 5 });
    expect(parseTime("01:05 Am", enUS)).toEqual({ hour: 1, minute: 5 });
    expect(parseTime("01:05 PM", enGB12)).toEqual({ hour: 13, minute: 5 });
  });

  test("reads a regular space, U+00A0, U+202F or a run of spaces where the pattern has whitespace", () => {
    for (const space of [" ", "\u00a0", "\u202f", "  "]) {
      expect(parseTime(`01:05${space}PM`, enUS)).toEqual({ hour: 13, minute: 5 });
    }
  });

  test("reads a day period written before the hour", () => {
    expect(parseTime("오전 12:05", koKR)).toEqual({ hour: 0, minute: 5 });
    expect(parseTime("오후 12:05", koKR)).toEqual({ hour: 12, minute: 5 });
    expect(parseTime("午後1:05", new Locale("ja-JP-u-hc-h12"))).toEqual({ hour: 13, minute: 5 });
  });

  test("reads 24-hour times on a 24-hour clock", () => {
    expect(parseTime("00:00", deDE)).toEqual({ hour: 0, minute: 0 });
    expect(parseTime("23:59", enUS24)).toEqual({ hour: 23, minute: 59 });
  });

  test("leaves a 24-hour clock's fields unchecked", () => {
    expect(parseTime("25:00", deDE)).toEqual({ hour: 25, minute: 0 });
    expect(parseTime("12:60", deDE)).toEqual({ hour: 12, minute: 60 });
  });

  test("ignores whitespace around the time and bidi marks", () => {
    expect(parseTime(" \t01:05 PM ", enUS)).toEqual({ hour: 13, minute: 5 });
    expect(parseTime("\u200f01:05\u200e PM", enUS)).toEqual({ hour: 13, minute: 5 });
  });

  test.for([
    ["00:00 AM", "hour 0 on a 12-hour clock"],
    ["13:00 PM", "hour 13 on a 12-hour clock"],
    ["01:05", "a missing day period"],
    ["01:05 XM", "a day period that is not the locale's"],
    ["01:05 a.m.", "another locale's day period"],
    ["001:05 PM", "a three-digit hour"],
    ["01:5 PM", "a one-digit minute"],
    ["01.05 PM", "a separator that is not the locale's"],
    ["01:05PM", "no space where the locale writes one"],
    ["13:05", "a 24-hour time"],
    ["", "an empty string"],
  ])("rejects %o, %s, in en-US", ([str]) => {
    expect(parseTime(str as string, enUS)).toBeUndefined();
  });

  test("rejects a day period on a 24-hour clock", () => {
    expect(parseTime("01:05 PM", deDE)).toBeUndefined();
  });
});

describe("layoutDateTime", () => {
  test("reads the date first with the text before, between and after", () => {
    expect(layoutDateTime("<D, T>", "D", "T")).toEqual({ timeFirst: false, literals: ["<", ", ", ">"] });
  });

  test("reads the time first", () => {
    expect(layoutDateTime("[T | D]", "D", "T")).toEqual({ timeFirst: true, literals: ["[", " | ", "]"] });
  });

  test("reads adjacent halves with nothing between", () => {
    expect(layoutDateTime("DT", "D", "T")).toEqual({ timeFirst: false, literals: ["", "", ""] });
    expect(layoutDateTime("TD", "D", "T")).toEqual({ timeFirst: true, literals: ["", "", ""] });
  });

  test.for([
    ["X T", "a missing date"],
    ["D X", "a missing time"],
    ["1/2/3", "a date and a time that overlap"],
    ["3/1/2", "a time and a date that overlap"],
  ])("falls back to the date, a space and the time on %o, %s", ([combined]) => {
    const [date, time] = combined === "1/2/3" || combined === "3/1/2" ? ["1/2", "2/3"] : ["D", "T"];

    expect(layoutDateTime(combined as string, date as string, time as string)).toEqual({ timeFirst: false, literals: ["", " ", ""] });
  });
});

describe("resolveDateTimeLayout", () => {
  test("en-US writes the date first with a comma between", () => {
    expect(resolveDateTimeLayout(enUS)).toEqual({ timeFirst: false, literals: ["", ", ", ""] });
  });

  test("vi writes the time first", () => {
    expect(resolveDateTimeLayout(vi).timeFirst).toBe(true);
  });

  test("two Locale instances for the same canonical tag share one cached layout", () => {
    expect(resolveDateTimeLayout(new Locale("en-us"))).toBe(resolveDateTimeLayout(enUS));
  });
});

describe("formatDateTime", () => {
  const date = { year: 2026, month: 2, day: 3 };

  test("writes the date, the locale's text between, and the time", () => {
    expect(spaced(formatDateTime(date, { hour: 13, minute: 5 }, enUS))).toBe("02/03/2026, 01:05 PM");
    expect(formatDateTime(date, { hour: 0, minute: 0 }, deDE)).toBe("03.02.2026, 00:00");
  });

  test("writes the time first where the locale does", () => {
    const { literals } = resolveDateTimeLayout(vi);

    expect(formatDateTime(date, { hour: 13, minute: 5 }, vi)).toBe(`${literals[0]}13:05${literals[1]}03/02/2026${literals[2]}`);
  });

  test.for(["en-US", "en-GB", "de-DE", "ja-JP", "ar-EG", "he-IL", "fr-FR", "ko-KR", "vi", "bg-BG", "en-GB-u-hc-h12", "en-US-u-hc-h23"])(
    "matches Intl's own spelling in %s",
    (tag) => {
      const locale = new Locale(tag);
      const intl = intlParts(
        tag,
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: locale.uses24Hour ? "h23" : "h12",
        },
        Date.UTC(2026, 1, 3, 9, 5),
      );

      expect(formatDateTime(date, { hour: 9, minute: 5 }, locale)).toBe(intl);
    },
  );
});

describe("parseDateTime", () => {
  test("splits the string into the date and the time", () => {
    expect(parseDateTime("02/03/2026, 01:05 PM", enUS)).toEqual({ date: "02/03/2026", time: "01:05 PM" });
    expect(parseDateTime("13:05 03/02/2026", vi)).toEqual({ date: "03/02/2026", time: "13:05" });
  });

  test("removes bidi marks and ignores whitespace around the date-time", () => {
    expect(parseDateTime(" 03\u200f/02\u200f/2026\u060c 01:05 \u0645 ", arEG)).toEqual({ date: "03/02/2026", time: "01:05 \u0645" });
  });

  test("reads any whitespace where the locale's text between has whitespace", () => {
    expect(parseDateTime("02/03/2026,\u202f01:05\u00a0PM", enUS)).toEqual({ date: "02/03/2026", time: "01:05\u00a0PM" });
  });

  test.for([
    ["02/03/2026 01:05 PM", "a missing comma"],
    ["01:05 PM, 02/03/2026", "the time first"],
    ["02/03/2026, 13:05", "a 24-hour time"],
    ["02/03/26, 01:05 PM", "a two-digit year"],
    ["02/03/2026", "a date alone"],
    ["", "an empty string"],
  ])("rejects %o, %s, in en-US", ([str]) => {
    expect(parseDateTime(str as string, enUS)).toBeUndefined();
  });

  test("leaves the fields unchecked", () => {
    expect(parseDateTime("02/30/2026, 13:00 PM", enUS)).toEqual({ date: "02/30/2026", time: "13:00 PM" });
  });

  test("reads the locale's own 24-hour layout", () => {
    expect(parseDateTime("03/02/2026, 00:00", enGB)).toEqual({ date: "03/02/2026", time: "00:00" });
  });
});
