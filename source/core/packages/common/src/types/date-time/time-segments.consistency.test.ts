import { describe, expect, test } from "vitest";
import { Locale } from "../../locale";
import { LocalTime } from "./local-time";
import type { TimeOptions } from "./locale-format";

// Every expectation is derived from the library's own output under the running runtime's ICU:
// the space before a day period (U+202F or U+0020) and bidi marks differ between ICU versions,
// so no literal string carrying them is written here.

const tags = ["en-US", "de-DE", "ja-JP", "ko-KR", "ar-EG"] as const;

const times = [
  ["midnight", LocalTime.of(0, 0)],
  ["noon", LocalTime.of(12, 0)],
  ["a morning time", LocalTime.of(9, 5)],
  ["an afternoon time", LocalTime.of(15, 45)],
  ["a time with seconds", LocalTime.of(23, 59, 58)],
] as const;

const optionSets: ReadonlyArray<readonly [string, TimeOptions]> = [
  ["without seconds", {}],
  ["with seconds", { seconds: true }],
];

describe.each(tags)("LocalTime segments in %s", (tag) => {
  const locale = new Locale(tag);

  describe.each(optionSets)("%s", (_, options) => {
    test.each(times)("joins the segments of %s into exactly the formatted string", (_, time) => {
      const joined = time
        .segments(locale, options)
        .map((segment) => segment.value)
        .join("");

      expect(joined).toBe(time.format(locale, options));
    });

    test.each(times)("writes a day period for %s only on a 12-hour clock", (_, time) => {
      const dayPeriods = time.segments(locale, options).filter((segment) => segment.type === "dayPeriod");

      expect(dayPeriods).toHaveLength(locale.uses24Hour ? 0 : 1);
    });

    test.each(times)("writes the day period of %s as the locale's marker for its half of the day", (_, time) => {
      const { am, pm } = LocalTime.dayPeriods(locale);
      const expected = time.hour < 12 ? am : pm;

      for (const segment of time.segments(locale, options)) {
        if (segment.type === "dayPeriod") {
          expect(segment.value).toBe(expected);
        }
      }
    });

    test.each(times)("reads %s back from its formatted string", (_, time) => {
      const result = LocalTime.tryParseLocalized(time.format(locale, options), locale, options);
      const expected = options.seconds === true ? time : LocalTime.of(time.hour, time.minute);

      expect(result.success).toBe(true);
      expect(result.value?.toString()).toBe(expected.toString());
    });

    test.each(times)("reads %s back from its joined segments", (_, time) => {
      const joined = time
        .segments(locale, options)
        .map((segment) => segment.value)
        .join("");
      const result = LocalTime.tryParseLocalized(joined, locale, options);
      const expected = options.seconds === true ? time : LocalTime.of(time.hour, time.minute);

      expect(result.success).toBe(true);
      expect(result.value?.toString()).toBe(expected.toString());
    });
  });

  test("gives distinct markers for the two halves of the day", () => {
    const { am, pm } = LocalTime.dayPeriods(locale);

    expect(am).not.toBe(pm);
    expect(am.length).toBeGreaterThan(0);
    expect(pm.length).toBeGreaterThan(0);
  });
});
