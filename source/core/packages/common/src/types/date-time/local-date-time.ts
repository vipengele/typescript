import type { Clock } from "../../time/clock";
import type { IsoDayOfWeek } from "./civil";
import { DateTimeParseError, type DateTimeTryParseResult } from "./errors";
import { LocalDate } from "./local-date";
import { LocalTime } from "./local-time";
import { civilNow } from "./now";

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
 * A date and a time of day with no time zone: a {@link LocalDate} and a {@link LocalTime} taken
 * together, from 0001-01-01T00:00 to 9999-12-31T23:59:59.999.
 *
 * Both components are validated by their own types, so every instance names a real moment on the
 * civil calendar. Instances are frozen; every operation returns a new one.
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
  static ofFields(year: number, month: number, day: number, hour: number, minute: number, second = 0, millisecond = 0): LocalDateTime {
    return new LocalDateTime(LocalDate.of(year, month, day), LocalTime.of(hour, minute, second, millisecond));
  }

  /**
   * The current date and time of day in the runtime's time zone, to the millisecond, at the
   * instant `clock` reads (by default `systemClock`). The date and the time come from one
   * reading of the clock.
   *
   * @throws {RangeError} when the clock returns a value that is not a finite time within ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date falls outside 0001-01-01 to 9999-12-31.
   */
  static now(clock?: Clock): LocalDateTime {
    const { year, month, day, hour, minute, second, millisecond } = civilNow(clock);
    return LocalDateTime.ofFields(year, month, day, hour, minute, second, millisecond);
  }

  /**
   * Reads the ISO 8601 date-time `str` spells, in `<date>T<time>` form: `2026-10-01T14:30`,
   * `2026-10-01T14:30:05` or `2026-10-01T14:30:05.250`. The date and the time follow the rules of
   * {@link LocalDate.parse} and {@link LocalTime.parse}.
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

  /** The ISO 8601 date-time, the date and the time joined by `T`: `2026-10-01T14:30`, `2026-10-01T14:30:05.250`. */
  toString(): string {
    return `${this.date}T${this.time}`;
  }
}
