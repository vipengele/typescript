import { describe, expect, test } from "vitest";
import { Locale } from "../../locale";
import { formatDate, parseDate, resolveDatePattern, stripBidiMarks } from "./locale-format";

const enUS = new Locale("en-US");
const deDE = new Locale("de-DE");
const jaJP = new Locale("ja-JP");
const arEG = new Locale("ar-EG");
const huHU = new Locale("hu-HU");

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
