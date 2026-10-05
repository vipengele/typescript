import { Locale } from "../../locale";
import type { Clock } from "../../time/clock";
import type { IsoDayOfWeek } from "./civil";
import { DateTimeParseError, type DateTimeTryParseResult } from "./errors";
import { LocalDate } from "./local-date";
import { LocalTime } from "./local-time";
import { formatDateTime, parseDateTime } from "./locale-format";
import { civilNow } from "./now";
import type { ZoneId } from "./zone-id";
import { ZonedDateTime, type ZonedDateTimeOptions } from "./zoned-date-time";

/** The date-time `str` spells in ISO 8601 `<date>T<time>` form, or `undefined` when it spells none. */
function parseValue(str: string): LocalDateTime | undefined {
  const separator = str.indexOf("T");
  if (separator === -1 || str.indexOf("T", separator + 1) !== -1) {
    return undefined;
  }
  const date = LocalDate.tryParse(str.slice(0, separator));
  const time = LocalTime.tryParse(str.slice(separator + 1));
  if (date.value === undefined || time.value === undefined) {
    return undefined;
  }
  return LocalDateTime.of(date.value, time.value);
}

/**
 * The date-time `str` writes in `locale`'s date-time layout, or `undefined` when it writes none.
 * Each half is read by its own type's localized reader.
 */
function parseLocalizedValue(str: string, locale: Locale): LocalDateTime | undefined {
  const text = parseDateTime(str, locale);
  if (text === undefined) {
    return undefined;
  }
  const date = LocalDate.tryParseLocalized(text.date, locale);
  const time = LocalTime.tryParseLocalized(text.time, locale);
  if (date.value === undefined || time.value === undefined) {
    return undefined;
  }
  return LocalDateTime.of(date.value, time.value);
}

/**
 * A date and a time of day with no time zone: a {@link LocalDate} and a {@link LocalTime} taken
 * together, from 0001-01-01T00:00 to 9999-12-31T23:59:59.999999999.
 *
 * Both components are validated by their own types, so every instance names a real moment on the
 * civil calendar. Instances are frozen; every operation returns a new one.
 *
 * This module touches {@link ZonedDateTime} only when a method runs, never while it evaluates:
 * it imports this module back, and a binding read during evaluation of the import cycle is not
 * yet initialised.
 */
export class LocalDateTime {
  /** The calendar date. */
  readonly date: LocalDate;
  /** The time of day. */
  readonly time: LocalTime;

  private constructor(date: LocalDate, time: LocalTime) {
    this.date = date;
    this.time = time;
    Object.freeze(this);
  }

  /** The date-time of `date` at `time`. */
  static of(date: LocalDate, time: LocalTime): LocalDateTime {
    return new LocalDateTime(date, time);
  }

  /**
   * The date-time with the given fields.
   *
   * @throws {InvalidDateTimeError} when the fields do not name a date and a time: see
   *   {@link LocalDate.of} and {@link LocalTime.of} for the ranges.
   */
  static ofFields(year: number, month: number, day: number, hour: number, minute: number, second = 0, nanosecond = 0): LocalDateTime {
    return new LocalDateTime(LocalDate.of(year, month, day), LocalTime.of(hour, minute, second, nanosecond));
  }

  /**
   * The current date and time of day in the runtime's time zone, to the microsecond, at the
   * instant `clock` reads (by default `systemClock`). The date and the time come from one
   * reading of the clock, floored rather than rounded, so the nanosecond's last three digits are
   * zero.
   *
   * @throws {RangeError} when the clock returns a value that is not a finite time within ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date falls outside 0001-01-01 to 9999-12-31.
   */
  static now(clock?: Clock): LocalDateTime {
    const { year, month, day, hour, minute, second, nanosecond } = civilNow(clock);
    return LocalDateTime.ofFields(year, month, day, hour, minute, second, nanosecond);
  }

  /**
   * Reads the ISO 8601 date-time `str` spells, in `<date>T<time>` form: `2026-10-01T14:30`,
   * `2026-10-01T14:30:05` or `2026-10-01T14:30:05.250`. The date and the time follow the rules of
   * {@link LocalDate.parse} and {@link LocalTime.parse}, so the fraction takes one to nine digits.
   *
   * @throws {DateTimeParseError} when `str` is not in that form, or its fields do not name a date
   *   and a time (`2026-02-30T10:00`, `2026-10-01T24:00`).
   */
  static parse(str: string): LocalDateTime {
    const value = parseValue(str);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as an ISO 8601 date-time.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalDateTime.parse}: a string that does not spell a
   * date-time yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParse(str: string): DateTimeTryParseResult<LocalDateTime> {
    const value = parseValue(str);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /**
   * Reads the date-time `str` writes in `locale`'s layout, or in `Locale.default()` when `locale`
   * is omitted: `02/03/2026, 01:30 PM` in `en-US`, `03.02.2026, 13:30` in `de-DE`. The date
   * follows {@link LocalDate.parseLocalized}'s rules and the time
   * {@link LocalTime.parseLocalized}'s, so the result's second and nanosecond are zero. Whether
   * the date or the time comes first, and the text around them, are read from `Intl`, matching
   * {@link LocalDateTime#format}; whitespace in that text matches any whitespace.
   *
   * {@link LocalDateTime.parse} stays the ISO 8601 reader: a locale-aware reader under the same
   * name would make `parse(str)` read the runtime's locale rather than ISO.
   *
   * @throws {DateTimeParseError} when `str` does not follow the layout, or its fields do not name
   *   a date and a time (`02/30/2026, 10:00 AM` or `02/03/2026, 13:00 PM` in `en-US`).
   */
  static parseLocalized(str: string, locale: Locale = Locale.default()): LocalDateTime {
    const value = parseLocalizedValue(str, locale);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as a date-time in ${locale.tag}.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalDateTime.parseLocalized}: a string that does not
   * write a date-time yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParseLocalized(str: string, locale: Locale = Locale.default()): DateTimeTryParseResult<LocalDateTime> {
    const value = parseLocalizedValue(str, locale);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /** A negative number when `a` is before `b`, a positive one when after, and `0` when they are equal. Dates order first, then times. */
  static compare(a: LocalDateTime, b: LocalDateTime): number {
    return LocalDate.compare(a.date, b.date) || LocalTime.compare(a.time, b.time);
  }

  /** Whether `other` names the same date and time. */
  equals(other: LocalDateTime): boolean {
    return LocalDateTime.compare(this, other) === 0;
  }

  /** The ISO day of the week of the date: 1 is Monday, 7 is Sunday. */
  get dayOfWeek(): IsoDayOfWeek {
    return this.date.dayOfWeek;
  }

  /** The number of days in the date's month, 28 to 31. */
  get lengthOfMonth(): number {
    return this.date.lengthOfMonth;
  }

  /** The date-time `days` days later at the same time of day; see {@link LocalDate.plusDays} for the errors. */
  plusDays(days: number): LocalDateTime {
    return new LocalDateTime(this.date.plusDays(days), this.time);
  }

  /** The date-time `days` days earlier at the same time of day; see {@link LocalDate.minusDays} for the errors. */
  minusDays(days: number): LocalDateTime {
    return new LocalDateTime(this.date.minusDays(days), this.time);
  }

  /** The date-time `months` months later at the same time of day, clamping the day as {@link LocalDate.plusMonths} does, with its errors. */
  plusMonths(months: number): LocalDateTime {
    return new LocalDateTime(this.date.plusMonths(months), this.time);
  }

  /** The date-time `months` months earlier at the same time of day, clamping the day as {@link LocalDate.minusMonths} does, with its errors. */
  minusMonths(months: number): LocalDateTime {
    return new LocalDateTime(this.date.minusMonths(months), this.time);
  }

  /**
   * This date and time of day in `zone`, as {@link ZonedDateTime.of} builds it: a time the zone
   * skips or reads twice is settled by `options.disambiguation`, `compatible` by default.
   *
   * @throws {ZoneResolutionError} when the disambiguation is `reject` and the time falls in a gap
   *   or an overlap.
   * @throws {InvalidDateTimeError} when moving a time in a gap carries it outside 0001-01-01 to 9999-12-31.
   */
  atZone(zone: ZoneId, options?: ZonedDateTimeOptions): ZonedDateTime {
    return ZonedDateTime.of(this, zone, options);
  }

  /**
   * The date-time in `locale`'s layout, or in `Locale.default()` when `locale` is omitted: the
   * date as {@link LocalDate#format} writes it and the time as {@link LocalTime#format} writes it,
   * in the order and with the text around them that `Intl` uses when it writes both together.
   * `02/03/2026, 01:30 PM` in `en-US`, `03.02.2026, 13:30` in `de-DE`, `13:30 03/02/2026` in `vi`.
   * When `Intl`'s combined output does not hold the two as separate runs, the date comes first
   * and a single space separates them.
   *
   * Like {@link LocalTime#format}, the second and the nanosecond are not written, so
   * {@link LocalDateTime.parseLocalized} under the same locale reads back this date-time with
   * both set to zero.
   */
  format(locale: Locale = Locale.default()): string {
    return formatDateTime(this.date, this.time, locale);
  }

  /**
   * The ISO 8601 date-time, the date and the time joined by `T` as {@link LocalTime#toString}
   * writes it: `2026-10-01T14:30`, `2026-10-01T14:30:05.250`, `2026-10-01T14:30:05.123456`.
   */
  toString(): string {
    return `${this.date}T${this.time}`;
  }
}
