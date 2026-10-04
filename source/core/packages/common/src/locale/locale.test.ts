import { afterEach, describe, expect, test, vi } from "vitest";
import { Locale } from "./index";
import { readFirstDayOfWeek, type WeekInfoSource } from "./locale";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("construction", () => {
  test("keeps a valid tag", () => {
    expect(new Locale("sv-SE").tag).toBe("sv-SE");
  });

  test("canonicalizes the tag's case", () => {
    expect(new Locale("EN-us").tag).toBe("en-US");
  });

  test.each(["", "not a tag", "en_US"])("rejects %j with a RangeError", (tag) => {
    expect(() => new Locale(tag)).toThrow(RangeError);
  });
});

describe("Locale.default", () => {
  test("wraps the runtime's resolved locale", () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;

    expect(Locale.default().tag).toBe(resolved);
  });

  test("reads the runtime locale on every call", () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValueOnce({ locale: "de-DE" } as Intl.ResolvedDateTimeFormatOptions)
      .mockReturnValueOnce({ locale: "ja-JP" } as Intl.ResolvedDateTimeFormatOptions);

    expect(Locale.default().tag).toBe("de-DE");
    expect(Locale.default().tag).toBe("ja-JP");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("hour cycle", () => {
  test("en-US is a 12-hour locale", () => {
    const locale = new Locale("en-US");

    expect(["h11", "h12"]).toContain(locale.hourCycle);
    expect(locale.uses24Hour).toBe(false);
  });

  test("de-DE is a 24-hour locale", () => {
    const locale = new Locale("de-DE");

    expect(["h23", "h24"]).toContain(locale.hourCycle);
    expect(locale.uses24Hour).toBe(true);
  });

  test("an explicit hour-cycle extension is honoured", () => {
    expect(new Locale("en-US-u-hc-h23").uses24Hour).toBe(true);
    expect(new Locale("de-DE-u-hc-h12").uses24Hour).toBe(false);
  });

  test.each([
    ["h11", false],
    ["h12", false],
    ["h23", true],
    ["h24", true],
  ] as const)("%s maps to uses24Hour %s", (hourCycle, expected) => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      hourCycle,
    } as Intl.ResolvedDateTimeFormatOptions);

    expect(new Locale("en-US").uses24Hour).toBe(expected);
  });
});

describe("monthNames", () => {
  test("lists January through December in English", () => {
    const names = new Locale("en-US").monthNames("long");

    expect(names).toHaveLength(12);
    expect(names[0]).toBe("January");
    expect(names[11]).toBe("December");
  });

  test("short style abbreviates", () => {
    expect(new Locale("en-US").monthNames("short").slice(0, 3)).toEqual(["Jan", "Feb", "Mar"]);
  });

  test("narrow style is a single letter in English", () => {
    expect(new Locale("en-US").monthNames("narrow")[0]).toBe("J");
  });

  test("names follow the locale", () => {
    expect(new Locale("fr-FR").monthNames("long")[1]).toBe("février");
  });
});

describe("weekdayNames", () => {
  test("starts on Monday and ends on Sunday regardless of locale", () => {
    const en = new Locale("en-US").weekdayNames("long");
    const ar = new Locale("ar-EG").weekdayNames("long");

    expect(en).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(ar).toHaveLength(7);
    expect(ar[0]).not.toBe(en[0]);
  });

  test("short style abbreviates", () => {
    expect(new Locale("en-US").weekdayNames("short")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  test("narrow style is a single letter in English", () => {
    expect(new Locale("en-US").weekdayNames("narrow")[0]).toBe("M");
  });

  test("names follow the locale", () => {
    expect(new Locale("de-DE").weekdayNames("long")[0]).toBe("Montag");
  });
});

describe("caching", () => {
  test("the hour cycle builds one formatter however often it is read", () => {
    const locale = new Locale("en-US");
    const spy = vi.spyOn(Intl, "DateTimeFormat");

    const first = locale.hourCycle;
    expect(locale.hourCycle).toBe(first);
    expect(locale.uses24Hour).toBe(false);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("month names build one formatter per style", () => {
    const locale = new Locale("en-US");
    const spy = vi.spyOn(Intl, "DateTimeFormat");

    locale.monthNames("long");
    locale.monthNames("long");
    expect(spy).toHaveBeenCalledTimes(1);

    locale.monthNames("short");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("weekday names build one formatter per style", () => {
    const locale = new Locale("en-US");
    const spy = vi.spyOn(Intl, "DateTimeFormat");

    locale.weekdayNames("long");
    locale.weekdayNames("long");
    expect(spy).toHaveBeenCalledTimes(1);

    locale.weekdayNames("narrow");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("mutating a returned month array leaves the next call intact", () => {
    const locale = new Locale("en-US");
    const first = locale.monthNames("long");
    first[0] = "mutated";
    first.length = 0;

    expect(locale.monthNames("long")[0]).toBe("January");
    expect(locale.monthNames("long")).toHaveLength(12);
    expect(locale.monthNames("long")).not.toBe(first);
  });

  test("mutating a returned weekday array leaves the next call intact", () => {
    const locale = new Locale("en-US");
    const first = locale.weekdayNames("long");
    first[0] = "mutated";

    expect(locale.weekdayNames("long")[0]).toBe("Monday");
  });

  test("the first day of the week is stable across reads", () => {
    const locale = new Locale("en-US");

    expect(locale.firstDayOfWeek).toBe(7);
    expect(locale.firstDayOfWeek).toBe(7);
  });

  test("instances do not share cached values", () => {
    expect(new Locale("en-US").monthNames("long")[1]).toBe("February");
    expect(new Locale("fr-FR").monthNames("long")[1]).toBe("février");
  });
});

describe("first day of the week", () => {
  test.each([
    ["en-US", 7],
    ["de-DE", 1],
    ["ar-EG", 6],
  ] as const)("%s starts its week on ISO day %i", (tag, expected) => {
    expect(new Locale(tag).firstDayOfWeek).toBe(expected);
  });

  test("reads getWeekInfo() when the engine offers it", () => {
    const source = class {
      getWeekInfo() {
        return { firstDay: 6 };
      }
      get weekInfo() {
        return { firstDay: 3 };
      }
    } satisfies WeekInfoSource;

    expect(readFirstDayOfWeek("en-US", source)).toBe(6);
  });

  test("reads the weekInfo property when getWeekInfo() is absent", () => {
    const source = class {
      readonly weekInfo = { firstDay: 7 };
    } satisfies WeekInfoSource;

    expect(readFirstDayOfWeek("en-US", source)).toBe(7);
  });

  test("falls back to Monday when the engine exposes no week info", () => {
    const source = class {} satisfies WeekInfoSource;

    expect(readFirstDayOfWeek("en-US", source)).toBe(1);
  });

  test("passes the tag to the source", () => {
    const tags: string[] = [];
    const source = class {
      constructor(tag: string) {
        tags.push(tag);
      }
    } satisfies WeekInfoSource;

    readFirstDayOfWeek("ar-EG", source);

    expect(tags).toEqual(["ar-EG"]);
  });
});
