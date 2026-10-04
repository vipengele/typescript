import type { Clock } from "../../time/clock";
import { civilFromDays, daysFromCivil, dayOfWeekFromDays, type IsoDayOfWeek, lengthOfMonth } from "./civil";
import { DateTimeParseError, type DateTimeTryParseResult, InvalidDateTimeError } from "./errors";
import { civilNow } from "./now";

/** The earliest year a {@link LocalDate} holds; year 0 and earlier have no four-digit ISO form. */
const MIN_YEAR = 1;

/** The latest year a {@link LocalDate} holds, the last one the four-digit ISO form can spell. */
const MAX_YEAR = 9999;

/** `YYYY-MM-DD`, exactly: no sign, no expanded year, no week or ordinal date, no surrounding space. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Why the fields do not name a date, or `undefined` when they do. */
function invalidReason(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return `year must be an integer from ${MIN_YEAR} to ${MAX_YEAR}, got ${year}`;
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return `month must be an integer from 1 to 12, got ${month}`;
  }
  const length = lengthOfMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > length) {
    return `day must be an integer from 1 to ${length} in ${year}-${String(month).padStart(2, "0")}, got ${day}`;
  }
  return undefined;
}

/** The date `str` spells in ISO 8601 `YYYY-MM-DD` form, or `undefined` when it spells none. */
function parseValue(str: string): LocalDate | undefined {
  const match = ISO_DATE.exec(str);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return invalidReason(year, month, day) === undefined ? LocalDate.of(year, month, day) : undefined;
}

/** @throws {RangeError} when `amount` is not a safe integer. */
function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`The amount must be a safe integer, got ${amount}.`);
  }
}

/**
 * A calendar date with no time of day and no time zone, in the proleptic Gregorian calendar
 * from 0001-01-01 to 9999-12-31.
 *
 * Every instance names a real date: {@link LocalDate.of} rejects fields that overflow rather
 * than rolling them into the next month, and arithmetic that would leave the supported range
 * throws. Instances are frozen; every operation returns a new one.
 */
export class LocalDate {
  /** The year, 1-9999. */
  readonly year: number;
  /** The month of the year, 1 (January) to 12 (December). */
  readonly month: number;
  /** The day of the month, 1 to {@link LocalDate.lengthOfMonth}. */
  readonly day: number;

  private constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
    Object.freeze(this);
  }

  /**
   * The date with the given fields.
   *
   * @throws {InvalidDateTimeError} when the fields do not name a date from 0001-01-01 to
   *   9999-12-31: a non-integer field, a month outside 1-12, or a day outside its month.
   */
  static of(year: number, month: number, day: number): LocalDate {
    const reason = invalidReason(year, month, day);
    if (reason !== undefined) {
      throw new InvalidDateTimeError(`Invalid date: ${reason}.`);
    }
    return new LocalDate(year, month, day);
  }

  /**
   * Today's date in the runtime's time zone, at the instant `clock` reads (by default
   * `systemClock`).
   *
   * @throws {RangeError} when the clock returns a value that is not a finite time within ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date falls outside 0001-01-01 to 9999-12-31.
   */
  static now(clock?: Clock): LocalDate {
    const { year, month, day } = civilNow(clock);
    return LocalDate.of(year, month, day);
  }

  /**
   * Reads the ISO 8601 calendar date `str` spells, in `YYYY-MM-DD` form.
   *
   * @throws {DateTimeParseError} when `str` is not in that form, or its fields do not name a date
   *   (`2026-02-30`).
   */
  static parse(str: string): LocalDate {
    const value = parseValue(str);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as an ISO 8601 date.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link LocalDate.parse}: a string that does not spell a date
   * yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParse(str: string): DateTimeTryParseResult<LocalDate> {
    const value = parseValue(str);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /** A negative number when `a` is before `b`, a positive one when after, and `0` when they are equal. */
  static compare(a: LocalDate, b: LocalDate): number {
    return a.year - b.year || a.month - b.month || a.day - b.day;
  }

  /** Whether `other` names the same date. */
  equals(other: LocalDate): boolean {
    return LocalDate.compare(this, other) === 0;
  }

  /** The ISO day of the week: 1 is Monday, 7 is Sunday. */
  get dayOfWeek(): IsoDayOfWeek {
    return dayOfWeekFromDays(daysFromCivil(this.year, this.month, this.day));
  }

  /** The number of days in this date's month, 28 to 31. */
  get lengthOfMonth(): number {
    return lengthOfMonth(this.year, this.month);
  }

  /**
   * The date `days` days later; a negative `days` goes back.
   *
   * @throws {RangeError} when `days` is not a safe integer.
   * @throws {InvalidDateTimeError} when the result falls outside 0001-01-01 to 9999-12-31.
   */
  plusDays(days: number): LocalDate {
    assertAmount(days);
    const { year, month, day } = civilFromDays(daysFromCivil(this.year, this.month, this.day) + days);
    return LocalDate.of(year, month, day);
  }

  /** The date `days` days earlier; the inverse of {@link LocalDate.plusDays}, with its errors. */
  minusDays(days: number): LocalDate {
    assertAmount(days);
    return this.plusDays(-days);
  }

  /**
   * The date `months` months later; a negative `months` goes back. A day past the end of the
   * target month clamps to its last day, so January 31 plus one month is February 28, or 29 in a
   * leap year.
   *
   * @throws {RangeError} when `months` is not a safe integer.
   * @throws {InvalidDateTimeError} when the result falls outside 0001-01-01 to 9999-12-31.
   */
  plusMonths(months: number): LocalDate {
    assertAmount(months);
    const monthIndex = this.year * 12 + (this.month - 1) + months;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex - year * 12 + 1;
    return LocalDate.of(year, month, Math.min(this.day, lengthOfMonth(year, month)));
  }

  /** The date `months` months earlier, clamping the day as {@link LocalDate.plusMonths} does, with its errors. */
  minusMonths(months: number): LocalDate {
    assertAmount(months);
    return this.plusMonths(-months);
  }

  /** The ISO 8601 calendar date, `YYYY-MM-DD`: `2026-10-01`. */
  toString(): string {
    const year = String(this.year).padStart(4, "0");
    const month = String(this.month).padStart(2, "0");
    const day = String(this.day).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
