import { Locale } from "../../locale";
import type { Clock } from "../../time/clock";
import { DateTimeParseError, type DateTimeTryParseResult, InvalidDateTimeError } from "./errors";
import { formatFraction, parseFraction } from "./fraction";
import { formatTime, parseTime } from "./locale-format";
import { civilNow } from "./now";

/**
 * `HH:mm`, `HH:mm:ss` or `HH:mm:ss.` followed by fraction digits, exactly: no zone designator, no
 * surrounding space. {@link parseFraction} decides how many fraction digits are accepted.
 */
const ISO_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

/** Why the fields do not name a time of day, or `undefined` when they do. */
function invalidReason(hour: number, minute: number, second: number, nanosecond: number): string | undefined {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return `hour must be an integer from 0 to 23, got ${hour}`;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return `minute must be an integer from 0 to 59, got ${minute}`;
  }
  if (!Number.isInteger(second) || second < 0 || second > 59) {
    return `second must be an integer from 0 to 59, got ${second}`;
  }
  if (!Number.isInteger(nanosecond) || nanosecond < 0 || nanosecond > 999_999_999) {
    return `nanosecond must be an integer from 0 to 999999999, got ${nanosecond}`;
  }
  return undefined;
}

/** The time of day `str` spells in ISO 8601 form, or `undefined` when it spells none. */
function parseValue(str: string): LocalTime | undefined {
  const match = ISO_TIME.exec(str);
  if (match === null) {
    return undefined;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  const nanosecond = match[4] === undefined ? 0 : parseFraction(match[4]);
  if (nanosecond === undefined) {
    return undefined;
  }
  return invalidReason(hour, minute, second, nanosecond) === undefined ? LocalTime.of(hour, minute, second, nanosecond) : undefined;
}

/**
 * The time `str` writes in `locale`'s time pattern, at second 0 and nanosecond 0, or `undefined`
 * when it writes none.
 */
function parseLocalizedValue(str: string, locale: Locale): LocalTime | undefined {
  const fields = parseTime(str, locale);
  if (fields === undefined) {
    return undefined;
  }
  const { hour, minute } = fields;
  return invalidReason(hour, minute, 0, 0) === undefined ? LocalTime.of(hour, minute) : undefined;
}

/**
 * A time of day with no date and no time zone, to the nanosecond, from 00:00 to 23:59:59.999999999.
 *
 * Every instance names a real time: {@link LocalTime.of} rejects a field outside its range rather
 * than carrying it into the next unit, so hour 24 and second 60 are errors. Instances are frozen.
 */
export class LocalTime {
  /** The hour of the day, 0-23. */
  readonly hour: number;
  /** The minute of the hour, 0-59. */
  readonly minute: number;
  /** The second of the minute, 0-59. */
  readonly second: number;
  /** The nanosecond of the second, 0-999 999 999. */
  readonly nanosecond: number;

  private constructor(hour: number, minute: number, second: number, nanosecond: number) {
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.nanosecond = nanosecond;
    Object.freeze(this);
  }

  /**
   * The time with the given fields.
   *
   * @throws {InvalidDateTimeError} when a field is not an integer in its range: hour 0-23, minute
   *   0-59, second 0-59, nanosecond 0-999 999 999.
   */
  static of(hour: number, minute: number, second = 0, nanosecond = 0): LocalTime {
    const reason = invalidReason(hour, minute, second, nanosecond);
    if (reason !== undefined) {
      throw new InvalidDateTimeError(`Invalid time: ${reason}.`);
    }
    return new LocalTime(hour, minute, second, nanosecond);
  }

  /**
   * The current time of day in the runtime's time zone, to the microsecond, at the instant `clock`
   * reads (by default `systemClock`). The reading is floored, never rounded, so the nanosecond's
   * last three digits are zero.
   *
   * @throws {RangeError} when the clock returns a value that is not a finite time within ±8.64e15 ms of the epoch.
   */
  static now(clock?: Clock): LocalTime {
    const { hour, minute, second, nanosecond } = civilNow(clock);
    return LocalTime.of(hour, minute, second, nanosecond);
  }

  /**
   * Reads the ISO 8601 time of day `str` spells, in `HH:mm`, `HH:mm:ss` or `HH:mm:ss.f` form. The
   * fraction takes one to nine digits and is a decimal of a second, right-padded rather than
   * rounded: `.5` is 500 000 000 ns and `.1234` is 123 400 000 ns.
   *
   * @throws {DateTimeParseError} when `str` is not in one of those forms, or its fields do not name
   *   a time (`24:00`, `12:60`, `12:00:60`), or its fraction has more than nine digits.
   */
  static parse(str: string): LocalTime {
    const value = parseValue(str);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as an ISO 8601 time.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalTime.parse}: a string that does not spell a time
   * yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParse(str: string): DateTimeTryParseResult<LocalTime> {
    const value = parseValue(str);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /**
   * Reads the hour and minute `str` writes in `locale`'s time pattern, or in `Locale.default()`
   * when `locale` is omitted: `01:30 PM` in `en-US`, `13:30` in `de-DE`, `午後01:30` in `ja-JP` on
   * a 12-hour clock. The result's second and nanosecond are zero. The locale's separators,
   * day-period markers and hour cycle are read from `Intl`, matching {@link LocalTime#format}.
   *
   * On a 12-hour clock the hour is 1-12 and the day-period marker must be one of the locale's own,
   * in any letter case: `12:00 AM` is midnight and `12:00 PM` noon. On a 24-hour clock the hour is
   * 0-23; `24:00` is rejected. The hour takes one or two digits, the minute two. Bidi marks
   * (U+200E, U+200F, U+061C) are ignored wherever they sit, whitespace around the time is ignored,
   * and any whitespace character stands for any other where the pattern has whitespace, so
   * `01:30 PM` typed with a regular space reads the same as `Intl`'s U+202F.
   *
   * {@link LocalTime.parse} stays the ISO 8601 reader: a locale-aware reader under the same name
   * would make `parse(str)` read the runtime's locale rather than ISO.
   *
   * @throws {DateTimeParseError} when `str` does not follow the pattern, or its fields do not name
   *   a time (`13:00 PM`, `00:30 AM`, `25:00`, `12:60`).
   */
  static parseLocalized(str: string, locale: Locale = Locale.default()): LocalTime {
    const value = parseLocalizedValue(str, locale);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as a time in ${locale.tag}.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalTime.parseLocalized}: a string that does not
   * write a time yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParseLocalized(str: string, locale: Locale = Locale.default()): DateTimeTryParseResult<LocalTime> {
    const value = parseLocalizedValue(str, locale);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /** A negative number when `a` is earlier in the day than `b`, a positive one when later, and `0` when they are equal. */
  static compare(a: LocalTime, b: LocalTime): number {
    return a.hour - b.hour || a.minute - b.minute || a.second - b.second || a.nanosecond - b.nanosecond;
  }

  /** Whether `other` names the same time of day. */
  equals(other: LocalTime): boolean {
    return LocalTime.compare(this, other) === 0;
  }

  /**
   * The hour and minute in `locale`'s time pattern, or in `Locale.default()` when `locale` is
   * omitted: `01:30 PM` in `en-US`, `13:30` in `de-DE`. Both are padded to two digits, in ASCII
   * digits whatever the locale's own defaults, on the locale's hour cycle: a 12-hour clock writes
   * 01-12 with the locale's day-period marker where the locale places it (`12:00 AM` is midnight),
   * a 24-hour clock writes 00-23 (midnight is `00:00`, never `24:00`). Separators, including the
   * U+202F some ICU versions put before `AM`, and bidi marks are kept as `Intl` emits them.
   *
   * The second and the nanosecond are not written: a time input edits the hour, the minute and
   * the day period, and the locale's short time pattern writes no more. So
   * {@link LocalTime.parseLocalized} under the same locale reads back this time with its second
   * and nanosecond set to zero.
   */
  format(locale: Locale = Locale.default()): string {
    return formatTime(this, locale);
  }

  /**
   * The ISO 8601 time of day: `HH:mm`, with `:ss` only when the second or the nanosecond is
   * non-zero, and a fraction only when the nanosecond is non-zero, in the shortest of 3, 6 or 9
   * digits that is exact. `14:30`, `14:30:05`, `14:30:05.250`, `14:30:05.123456`.
   */
  toString(): string {
    const hour = String(this.hour).padStart(2, "0");
    const minute = String(this.minute).padStart(2, "0");
    if (this.second === 0 && this.nanosecond === 0) {
      return `${hour}:${minute}`;
    }
    return `${hour}:${minute}:${String(this.second).padStart(2, "0")}${formatFraction(this.nanosecond)}`;
  }
}
