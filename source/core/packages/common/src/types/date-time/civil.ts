/**
 * Proleptic Gregorian calendar arithmetic on plain numbers. Days are counted from 1970-01-01
 * (day 0), with earlier dates negative. Nothing here reads a `Date` or a time zone: civil fields
 * map to a day count and back by integer arithmetic alone, so the result never depends on the
 * runtime's zone or its `Date` range.
 *
 * The day-count conversions follow Howard Hinnant's `days_from_civil` and `civil_from_days`,
 * which shift the year to start on March 1 so the leap day falls at the end of it, and split the
 * calendar into 400-year eras of 146 097 days each.
 */

/** Days in one 400-year era of the Gregorian calendar. */
const DAYS_PER_ERA = 146_097;

/** Days from 0000-03-01, the first day of era 0, to 1970-01-01. */
const EPOCH_OFFSET = 719_468;

/** A day of the week in ISO numbering: 1 is Monday, 7 is Sunday. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A year, month (1-12) and day of month (1-31). */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Whether `year` has a February 29: divisible by 4, except centuries not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The number of days in `month` (1-12) of `year`. */
export function lengthOfMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** The day count from 1970-01-01 to the given date. The fields are assumed valid. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - EPOCH_OFFSET;
}

/** The date `days` days after 1970-01-01; the inverse of {@link daysFromCivil}. */
export function civilFromDays(days: number): CivilDate {
  const shifted = days + EPOCH_OFFSET;
  const era = Math.floor(shifted / DAYS_PER_ERA);
  const dayOfEra = shifted - era * DAYS_PER_ERA;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** The ISO day of the week of the date `days` days after 1970-01-01, which was a Thursday. */
export function dayOfWeekFromDays(days: number): IsoDayOfWeek {
  return (((((days + 3) % 7) + 7) % 7) + 1) as IsoDayOfWeek;
}
