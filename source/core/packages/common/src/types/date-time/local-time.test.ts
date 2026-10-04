import { describe, expect, test, vi } from "vitest";
import { Locale } from "../../locale";
import { DateTimeParseError, InvalidDateTimeError, isDateTimeParseError, isInvalidDateTimeError } from "./errors";
import { LocalTime } from "./local-time";

describe("LocalTime.of", () => {
  test("holds the fields it is given", () => {
    const value = LocalTime.of(14, 30, 5, 250);

    expect([value.hour, value.minute, value.second, value.millisecond]).toEqual([14, 30, 5, 250]);
  });

  test("defaults the second and the millisecond to zero", () => {
    const value = LocalTime.of(14, 30);

    expect([value.second, value.millisecond]).toEqual([0, 0]);
  });

  test("accepts both ends of the day", () => {
    expect(LocalTime.of(0, 0).toString()).toBe("00:00");
    expect(LocalTime.of(23, 59, 59, 999).toString()).toBe("23:59:59.999");
  });

  test.for([
    [24, 0, 0, 0],
    [-1, 0, 0, 0],
    [0, 60, 0, 0],
    [0, -1, 0, 0],
    [0, 0, 60, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1000],
    [0, 0, 0, -1],
    [1.5, 0, 0, 0],
    [0, 1.5, 0, 0],
    [0, 0, 1.5, 0],
    [0, 0, 0, 1.5],
    [Number.NaN, 0, 0, 0],
    [0, Number.POSITIVE_INFINITY, 0, 0],
  ])("rejects %s:%s:%s.%s with InvalidDateTimeError", ([hour, minute, second, millisecond]) => {
    expect(() => LocalTime.of(hour as number, minute as number, second, millisecond)).toThrow(InvalidDateTimeError);
  });

  test("names the offending field in the message", () => {
    expect(() => LocalTime.of(24, 0)).toThrow("hour must be an integer from 0 to 23, got 24");
    expect(() => LocalTime.of(0, 60)).toThrow("minute must be an integer from 0 to 59, got 60");
    expect(() => LocalTime.of(0, 0, 60)).toThrow("second must be an integer from 0 to 59, got 60");
    expect(() => LocalTime.of(0, 0, 0, 1000)).toThrow("millisecond must be an integer from 0 to 999, got 1000");
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalTime.of(24, 0);
      expect.unreachable("LocalTime.of accepted hour 24");
    } catch (error) {
      expect(isInvalidDateTimeError(error)).toBe(true);
    }
  });

  test("returns a frozen value", () => {
    const value = LocalTime.of(14, 30);

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      (value as { hour: number }).hour = 1;
    }).toThrow(TypeError);
  });
});

describe("LocalTime.parse", () => {
  test.for(["00:00", "14:30", "23:59", "14:30:05", "00:00:01", "14:30:05.250", "23:59:59.999", "00:00:00.001"])("round-trips %s", (str) => {
    expect(LocalTime.parse(str).toString()).toBe(str);
  });

  test("reads the three forms", () => {
    expect(LocalTime.parse("14:30").equals(LocalTime.of(14, 30))).toBe(true);
    expect(LocalTime.parse("14:30:05").equals(LocalTime.of(14, 30, 5))).toBe(true);
    expect(LocalTime.parse("14:30:05.250").equals(LocalTime.of(14, 30, 5, 250))).toBe(true);
  });

  test("reads the fraction as a decimal of a second", () => {
    expect(LocalTime.parse("12:00:00.5").millisecond).toBe(500);
    expect(LocalTime.parse("12:00:00.05").millisecond).toBe(50);
    expect(LocalTime.parse("12:00:00.005").millisecond).toBe(5);
  });

  test("formats a zero second that has a millisecond", () => {
    expect(LocalTime.parse("12:00:00.5").toString()).toBe("12:00:00.500");
  });

  test("drops an all-zero seconds part", () => {
    expect(LocalTime.parse("12:00:00").toString()).toBe("12:00");
    expect(LocalTime.parse("12:00:00.000").toString()).toBe("12:00");
  });

  test.for([
    "",
    "24:00",
    "12:60",
    "12:00:60",
    "1:30",
    "14:3",
    "14.30",
    "1430",
    "14:30:5",
    "14:30:05.",
    "14:30:05.1234",
    "14:30.5",
    "T14:30",
    "14:30Z",
    " 14:30",
    "14:30 ",
    "-1:30",
    "ab:cd",
  ])("rejects %j with DateTimeParseError", (str) => {
    expect(() => LocalTime.parse(str)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises", () => {
    try {
      LocalTime.parse("24:00");
      expect.unreachable("LocalTime.parse accepted 24:00");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
    }
  });
});

describe("LocalTime.tryParse", () => {
  test("returns the value on success", () => {
    const result = LocalTime.tryParse("14:30:05");

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalTime.of(14, 30, 5))).toBe(true);
  });

  test.for(["", "24:00", "12:60", "12:00:60", "nope"])("returns success false for %j", (str) => {
    expect(LocalTime.tryParse(str)).toEqual({ success: false });
  });
});

describe("LocalTime.compare and equals", () => {
  test("orders by hour, minute, second then millisecond", () => {
    const ordered = ["00:00", "00:01", "00:01:01", "00:01:01.001", "00:01:01.002", "01:00", "23:59:59.999"].map((str) =>
      LocalTime.parse(str),
    );

    for (const [i, a] of ordered.entries()) {
      for (const [j, b] of ordered.entries()) {
        expect(Math.sign(LocalTime.compare(a, b))).toBe(Math.sign(i - j));
      }
    }
  });

  test("compare is zero exactly when equals is true", () => {
    const a = LocalTime.of(14, 30, 5, 250);

    expect(LocalTime.compare(a, LocalTime.of(14, 30, 5, 250))).toBe(0);
    expect(a.equals(LocalTime.of(14, 30, 5, 250))).toBe(true);
    expect(LocalTime.compare(a, LocalTime.of(14, 30, 5, 251))).not.toBe(0);
    expect(a.equals(LocalTime.of(14, 30, 5, 251))).toBe(false);
  });
});

/** `str` with every whitespace character as a regular space, so ICU's U+202F compares equal to it. */
const spaced = (str: string): string => str.replace(/\s/g, " ");

describe("LocalTime#format", () => {
  test.for([
    ["en-US", "01:30 PM"],
    ["en-GB", "13:30"],
    ["de-DE", "13:30"],
    ["fr-FR", "13:30"],
    ["ja-JP", "13:30"],
    ["ko-KR", "오후 01:30"],
    ["ar-EG", "01:30 \u0645"],
    ["en-GB-u-hc-h12", "01:30 pm"],
    ["en-US-u-hc-h23", "13:30"],
    ["ja-JP-u-hc-h12", "午後01:30"],
  ] as const)("writes 13:30 in %s as %s", ([tag, expected]) => {
    expect(spaced(LocalTime.of(13, 30).format(new Locale(tag)))).toBe(expected);
  });

  test.for([
    ["00:00", "12:00 AM", "00:00"],
    ["00:30", "12:30 AM", "00:30"],
    ["12:00", "12:00 PM", "12:00"],
    ["12:30", "12:30 PM", "12:30"],
    ["23:59", "11:59 PM", "23:59"],
  ] as const)("writes %s as %s on a 12-hour clock and %s on a 24-hour one", ([iso, twelve, twentyFour]) => {
    const time = LocalTime.parse(iso);

    expect(spaced(time.format(new Locale("en-US")))).toBe(twelve);
    expect(spaced(time.format(new Locale("en-GB-u-hc-h12")))).toBe(twelve.toLowerCase());
    expect(time.format(new Locale("en-GB"))).toBe(twentyFour);
    expect(time.format(new Locale("en-US-u-hc-h23"))).toBe(twentyFour);
  });

  test("never writes hour 24, even where the locale's cycle is h24", () => {
    const locale = new Locale("en-US-u-hc-h24");

    expect(locale.hourCycle).toBe("h24");
    expect(LocalTime.of(0, 0).format(locale)).toBe("00:00");
    expect(LocalTime.of(0, 59).format(locale)).toBe("00:59");
  });

  test("writes the second and the millisecond nowhere", () => {
    expect(LocalTime.of(13, 30, 45, 999).format(new Locale("de-DE"))).toBe("13:30");
  });

  test("an omitted locale writes in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(LocalTime.of(13, 30).format()).toBe("13:30");
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves toString as the ISO 8601 form", () => {
    expect(LocalTime.of(13, 30).toString()).toBe("13:30");
  });
});

describe("LocalTime.parseLocalized and tryParseLocalized", () => {
  const LOCALES = [
    "en-US",
    "en-GB",
    "de-DE",
    "ja-JP",
    "ar-EG",
    "he-IL",
    "fr-FR",
    "ko-KR",
    "en-GB-u-hc-h12",
    "en-US-u-hc-h23",
    "ja-JP-u-hc-h12",
    "ja-JP-u-hc-h11",
    "en-US-u-hc-h24",
  ];
  const TIMES = ["00:00", "00:30", "01:05", "11:59", "12:00", "12:30", "13:05", "23:59"];

  test.for(LOCALES.flatMap((tag) => TIMES.map((iso) => [tag, iso] as const)))("round-trips %s through format in %s", ([tag, iso]) => {
    const locale = new Locale(tag);
    const formatted = LocalTime.parse(iso).format(locale);

    expect(LocalTime.parseLocalized(formatted, locale).toString()).toBe(iso);
    expect(LocalTime.tryParseLocalized(formatted, locale).value?.toString()).toBe(iso);
  });

  test("reads back a time with seconds at second 0 and millisecond 0", () => {
    const locale = new Locale("en-US");
    const value = LocalTime.parseLocalized(LocalTime.of(13, 30, 45, 999).format(locale), locale);

    expect([value.hour, value.minute, value.second, value.millisecond]).toEqual([13, 30, 0, 0]);
  });

  test.for([
    ["12:00 AM", 0],
    ["12:59 AM", 0],
    ["1:00 AM", 1],
    ["11:00 AM", 11],
    ["12:00 PM", 12],
    ["1:00 PM", 13],
    ["11:00 PM", 23],
  ] as const)("reads %s on a 12-hour clock as hour %d", ([str, hour]) => {
    expect(LocalTime.parseLocalized(str, new Locale("en-US")).hour).toBe(hour);
  });

  test("reads the locale's own non-ASCII day periods", () => {
    expect(LocalTime.parseLocalized("오후 1:05", new Locale("ko-KR")).equals(LocalTime.of(13, 5))).toBe(true);
    expect(LocalTime.parseLocalized("午前12:05", new Locale("ja-JP-u-hc-h12")).equals(LocalTime.of(0, 5))).toBe(true);
    expect(LocalTime.parseLocalized("12:05 \u0645", new Locale("ar-EG")).equals(LocalTime.of(12, 5))).toBe(true);
  });

  test("reads the day period in any letter case and with any whitespace before it", () => {
    const locale = new Locale("en-US");

    expect(LocalTime.parseLocalized("01:05 pm", locale).equals(LocalTime.of(13, 5))).toBe(true);
    expect(LocalTime.parseLocalized("01:05\u202fPM", locale).equals(LocalTime.of(13, 5))).toBe(true);
    expect(LocalTime.parseLocalized("01:05\u00a0am", locale).equals(LocalTime.of(1, 5))).toBe(true);
  });

  test("returns the value on success", () => {
    const result = LocalTime.tryParseLocalized("9:05", new Locale("de-DE"));

    expect(result.success).toBe(true);
    expect(result.value?.equals(LocalTime.of(9, 5))).toBe(true);
  });

  test.for([
    ["en-US", "13:00 PM"],
    ["en-US", "00:00 AM"],
    ["en-US", "00:30 AM"],
    ["en-US", "12:60 PM"],
    ["en-US", "13:00"],
    ["en-US", "1:00"],
    ["en-US", "01:05 XM"],
    ["de-DE", "25:00"],
    ["de-DE", "24:00"],
    ["de-DE", "12:60"],
    ["de-DE", "01:05 PM"],
    ["de-DE", "13:30:00"],
    ["de-DE", "nope"],
    ["de-DE", ""],
  ] as const)("rejects %s %o", ([tag, str]) => {
    const locale = new Locale(tag);

    expect(LocalTime.tryParseLocalized(str, locale)).toEqual({ success: false });
    expect(() => LocalTime.parseLocalized(str, locale)).toThrow(DateTimeParseError);
  });

  test("throws an error the guard recognises, not InvalidDateTimeError", () => {
    try {
      LocalTime.parseLocalized("25:00", new Locale("de-DE"));
      expect.unreachable("LocalTime.parseLocalized accepted 25:00");
    } catch (error) {
      expect(isDateTimeParseError(error)).toBe(true);
      expect(isInvalidDateTimeError(error)).toBe(false);
    }
  });

  test("quotes the input and names the locale in the message", () => {
    expect(() => LocalTime.parseLocalized("nope", new Locale("de-DE"))).toThrow('Cannot parse "nope" as a time in de-DE.');
  });

  test("an omitted locale reads in Locale.default()", () => {
    const spy = vi.spyOn(Locale, "default").mockReturnValue(new Locale("de-DE"));

    try {
      expect(LocalTime.parseLocalized("13:30").equals(LocalTime.of(13, 30))).toBe(true);
      expect(LocalTime.tryParseLocalized("13:30").value?.equals(LocalTime.of(13, 30))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves parse and tryParse reading ISO 8601 only", () => {
    expect(LocalTime.tryParse("1:30 PM")).toEqual({ success: false });
    expect(LocalTime.parse("13:30").equals(LocalTime.of(13, 30))).toBe(true);
  });
});
