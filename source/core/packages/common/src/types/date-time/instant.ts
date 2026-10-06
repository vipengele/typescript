import { type Clock, systemClock } from "../../time/clock";
import { civilFromDays, daysFromCivil, lengthOfMonth } from "./civil";
import { DateTimeParseError, type DateTimeTryParseResult } from "./errors";
import { formatFraction, parseFraction } from "./fraction";
import { LocalDateTime } from "./local-date-time";
import type { ZoneId } from "./zone-id";
import { ZonedDateTime } from "./zoned-date-time";

/** The largest distance from the epoch, in seconds, an {@link Instant} spans: `Date`'s ±8.64e15 ms. */
const MAX_EPOCH_SECOND = 8_640_000_000_000;

/** The largest distance from the epoch, in milliseconds, an {@link Instant} spans. */
const MAX_EPOCH_MILLI = 8.64e15;

const NANOS_PER_SECOND = 1_000_000_000;
const NANOS_PER_MILLI = 1_000_000;
const MILLIS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 86_400;

/**
 * `YYYY-MM-DDTHH:mm:ss`, an optional `.` and fraction digits, and a literal `Z`, exactly: no offset,
 * no lower-case `z`, no surrounding space. The year is four digits, or a sign and six digits.
 * {@link parseFraction} decides how many fraction digits are accepted.
 */
const ISO_INSTANT = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

/** The remainder of `value` divided by `divisor`, from 0 to `divisor - 1` whatever the sign of `value`. */
function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** @throws {RangeError} when `amount` is not a safe integer. */
function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`The amount must be a safe integer, got ${amount}.`);
  }
}

/** Whether the instant `second` plus `nano` nanoseconds lies within ±8.64e15 ms of the epoch. */
function inRange(second: number, nano: number): boolean {
  return Math.abs(second) < MAX_EPOCH_SECOND || second === -MAX_EPOCH_SECOND || (second === MAX_EPOCH_SECOND && nano === 0);
}

/** @throws {RangeError} when the instant `second` plus `nano` nanoseconds lies outside ±8.64e15 ms of the epoch. */
function assertInRange(second: number, nano: number): void {
  if (!inRange(second, nano)) {
    throw new RangeError(`An instant must lie within ±${MAX_EPOCH_SECOND} seconds of the epoch, got ${second} s and ${nano} ns.`);
  }
}

/** The ISO 8601 year: four digits from 0000 to 9999, otherwise a sign and six digits. */
function formatYear(year: number): string {
  if (year < 0) {
    return `-${String(-year).padStart(6, "0")}`;
  }
  if (year > 9999) {
    return `+${String(year).padStart(6, "0")}`;
  }
  return String(year).padStart(4, "0");
}

/** The instant `str` spells in ISO 8601 form, or `undefined` when it spells none. */
function parseValue(str: string): Instant | undefined {
  const match = ISO_INSTANT.exec(str);
  // ISO 8601 has no negative zero year: year 0 is `0000` or `+000000`.
  if (match === null || match[1] === "-000000") {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const nanosecond = match[7] === undefined ? 0 : parseFraction(match[7]);
  if (nanosecond === undefined || month < 1 || month > 12 || day < 1 || day > lengthOfMonth(year, month)) {
    return undefined;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const epochSecond = daysFromCivil(year, month, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second;
  return inRange(epochSecond, nanosecond) ? Instant.ofEpochSecond(epochSecond, nanosecond) : undefined;
}

/**
 * A point on the UTC timeline, to the nanosecond, held as whole seconds from 1970-01-01T00:00:00Z
 * and a nanosecond of that second. The range is `Date`'s: ±8.64e15 milliseconds of the epoch, from
 * `-271821-04-20T00:00:00Z` to `+275760-09-13T00:00:00Z`, with both ends included.
 *
 * Both parts are safe integers and every operation is exact integer arithmetic on them: no
 * operation rounds through a double of nanoseconds, and none reads a `Date`. A value or a result
 * outside the range is a `RangeError`. Instances are frozen; every operation returns a new one.
 *
 * This module touches {@link LocalDateTime} and {@link ZonedDateTime} only when a method runs,
 * never while it evaluates: both import it back, and a binding read during evaluation of the
 * import cycle is not yet initialised.
 */
export class Instant {
  /** Whole seconds from the epoch, floored: an instant before the epoch has a negative second and a positive nano. */
  private readonly epochSecond: number;
  /** The nanosecond of {@link Instant.epochSecond}, 0-999 999 999. */
  private readonly nano: number;

  private constructor(epochSecond: number, nano: number) {
    this.epochSecond = epochSecond;
    this.nano = nano;
    Object.freeze(this);
  }

  /**
   * The instant `second` seconds and `nano` nanoseconds after the epoch. The nano is the
   * nanosecond of that second, never carried into it, so the instant 1 ns before the epoch is
   * `ofEpochSecond(-1, 999_999_999)`.
   *
   * @throws {RangeError} when `second` is not an integer, `nano` is not an integer from 0 to
   *   999 999 999, or the instant lies outside ±8.64e15 ms of the epoch.
   */
  static ofEpochSecond(second: number, nano = 0): Instant {
    if (!Number.isInteger(second)) {
      throw new RangeError(`The epoch second must be an integer, got ${second}.`);
    }
    if (!Number.isInteger(nano) || nano < 0 || nano >= NANOS_PER_SECOND) {
      throw new RangeError(`The nanosecond must be an integer from 0 to 999999999, got ${nano}.`);
    }
    assertInRange(second, nano);
    return new Instant(second, nano);
  }

  /**
   * The instant `milli` milliseconds after the epoch, exactly.
   *
   * @throws {RangeError} when `milli` is not an integer within ±8.64e15.
   */
  static ofEpochMilli(milli: number): Instant {
    if (!Number.isInteger(milli) || Math.abs(milli) > MAX_EPOCH_MILLI) {
      throw new RangeError(`The epoch millisecond must be an integer within ±${MAX_EPOCH_MILLI}, got ${milli}.`);
    }
    const milliOfSecond = floorMod(milli, MILLIS_PER_SECOND);
    return new Instant((milli - milliOfSecond) / MILLIS_PER_SECOND, milliOfSecond * NANOS_PER_MILLI);
  }

  /**
   * The instant `clock` reads (by default `systemClock`), to the microsecond. The reading is
   * floored, never rounded, so the nanosecond's last three digits are zero and a reading just
   * before the epoch is before it. The whole millisecond is taken from the reading directly, so it
   * is exact across the whole range; only the sub-millisecond remainder is scaled.
   *
   * @throws {RangeError} when the clock returns a value that is not a finite time within ±8.64e15 ms of the epoch.
   */
  static now(clock: Clock = systemClock): Instant {
    const reading = clock();
    const milli = Math.floor(reading);
    if (!(Math.abs(milli) <= MAX_EPOCH_MILLI)) {
      throw new RangeError(`The clock must return epoch milliseconds within ±${MAX_EPOCH_MILLI}, got ${milli}.`);
    }
    // A reading a hair below a whole millisecond leaves a remainder that scales to 1000 µs;
    // flooring puts it in the millisecond's last microsecond instead.
    const microsecond = Math.min(Math.floor((reading - milli) * 1000), 999);
    const milliOfSecond = floorMod(milli, MILLIS_PER_SECOND);
    return new Instant((milli - milliOfSecond) / MILLIS_PER_SECOND, milliOfSecond * NANOS_PER_MILLI + microsecond * 1000);
  }

  /**
   * Reads the ISO 8601 instant `str` spells, in `YYYY-MM-DDTHH:mm:ssZ` or
   * `YYYY-MM-DDTHH:mm:ss.fZ` form: `2026-10-01T12:30:00Z`, `2026-10-01T12:30:00.123456789Z`. The
   * fraction takes one to nine digits and is a decimal of a second, right-padded rather than
   * rounded. The zone is a literal upper-case `Z`; an offset is not read. A year outside 0000 to
   * 9999 is written in the expanded form, a sign and six digits (`+275760-09-13T00:00:00Z`,
   * `-271821-04-20T00:00:00Z`), which is also accepted for a year inside it (`+002026`).
   *
   * @throws {DateTimeParseError} when `str` is not in that form, its fields do not name a moment
   *   (`2026-02-30T00:00:00Z`, `2026-10-01T24:00:00Z`, `2026-10-01T12:00:60Z`), its fraction has
   *   more than nine digits, or it lies outside ±8.64e15 ms of the epoch.
   */
  static parse(str: string): Instant {
    const value = parseValue(str);
    if (value === undefined) {
      throw new DateTimeParseError(`Cannot parse ${JSON.stringify(str)} as an ISO 8601 instant.`);
    }
    return value;
  }

  /**
   * The non-throwing counterpart of {@link Instant.parse}: a string that does not spell an instant
   * yields `{ success: false }` rather than a {@link DateTimeParseError}.
   */
  static tryParse(str: string): DateTimeTryParseResult<Instant> {
    const value = parseValue(str);
    return value === undefined ? { success: false } : { success: true, value };
  }

  /** `-1` when `a` is before `b`, `1` when after, and `0` when they are the same instant. */
  static compare(a: Instant, b: Instant): number {
    return Math.sign(a.epochSecond - b.epochSecond || a.nano - b.nano);
  }

  /** Whether `other` is the same instant. */
  equals(other: Instant): boolean {
    return Instant.compare(this, other) === 0;
  }

  /** The nanosecond of {@link Instant#toEpochSecond}'s second, 0-999 999 999. */
  get nanosecond(): number {
    return this.nano;
  }

  /** Whole seconds from the epoch, floored, so an instant 1 ns before the epoch is second -1. */
  toEpochSecond(): number {
    return this.epochSecond;
  }

  /** Whole milliseconds from the epoch, floored, so an instant 1 ns before the epoch is millisecond -1. */
  toEpochMilli(): number {
    return this.epochSecond * MILLIS_PER_SECOND + Math.floor(this.nano / NANOS_PER_MILLI);
  }

  /**
   * The instant in `zone`: the date and time of day the zone's wall clock shows at it, with the
   * offset the zone reads in then. An instant names exactly one such reading, so a wall-clock time
   * the zone reads twice takes the offset this instant has, keeping the nanosecond.
   *
   * @throws {InvalidDateTimeError} when the date in `zone` falls outside 0001-01-01 to 9999-12-31.
   */
  atZone(zone: ZoneId): ZonedDateTime {
    const offsetSeconds = zone.offsetSecondsAt(this);
    const localSecond = this.epochSecond + offsetSeconds;
    const secondOfDay = floorMod(localSecond, SECONDS_PER_DAY);
    const { year, month, day } = civilFromDays((localSecond - secondOfDay) / SECONDS_PER_DAY);
    const local = LocalDateTime.ofFields(
      year,
      month,
      day,
      Math.floor(secondOfDay / 3600),
      Math.floor((secondOfDay % 3600) / 60),
      secondOfDay % 60,
      this.nano,
    );
    // The wall-clock time names this instant under `earlier` unless the zone reads it twice and
    // this is the second reading, which `later` names.
    const earlier = ZonedDateTime.of(local, zone, { disambiguation: "earlier" });
    return earlier.offsetSeconds === offsetSeconds ? earlier : ZonedDateTime.of(local, zone, { disambiguation: "later" });
  }

  /**
   * The instant `seconds` seconds later; a negative `seconds` goes back.
   *
   * @throws {RangeError} when `seconds` is not a safe integer, or the result lies outside ±8.64e15 ms of the epoch.
   */
  plusSeconds(seconds: number): Instant {
    assertAmount(seconds);
    return this.plus(seconds, 0);
  }

  /** The instant `seconds` seconds earlier; the inverse of {@link Instant.plusSeconds}, with its errors. */
  minusSeconds(seconds: number): Instant {
    return this.plusSeconds(-seconds);
  }

  /**
   * The instant `millis` milliseconds later; a negative `millis` goes back.
   *
   * @throws {RangeError} when `millis` is not a safe integer, or the result lies outside ±8.64e15 ms of the epoch.
   */
  plusMillis(millis: number): Instant {
    assertAmount(millis);
    const milliOfSecond = floorMod(millis, MILLIS_PER_SECOND);
    return this.plus((millis - milliOfSecond) / MILLIS_PER_SECOND, milliOfSecond * NANOS_PER_MILLI);
  }

  /** The instant `millis` milliseconds earlier; the inverse of {@link Instant.plusMillis}, with its errors. */
  minusMillis(millis: number): Instant {
    return this.plusMillis(-millis);
  }

  /**
   * The instant `nanos` nanoseconds later; a negative `nanos` goes back.
   *
   * @throws {RangeError} when `nanos` is not a safe integer, or the result lies outside ±8.64e15 ms of the epoch.
   */
  plusNanos(nanos: number): Instant {
    assertAmount(nanos);
    const nanoOfSecond = floorMod(nanos, NANOS_PER_SECOND);
    return this.plus((nanos - nanoOfSecond) / NANOS_PER_SECOND, nanoOfSecond);
  }

  /** The instant `nanos` nanoseconds earlier; the inverse of {@link Instant.plusNanos}, with its errors. */
  minusNanos(nanos: number): Instant {
    return this.plusNanos(-nanos);
  }

  /**
   * The ISO 8601 instant in UTC, `YYYY-MM-DDTHH:mm:ssZ` with a fraction only when the nanosecond is
   * non-zero, in the shortest of 3, 6 or 9 digits that is exact: `2026-10-01T12:30:00Z`,
   * `2026-10-01T12:30:00.123Z`, `2026-10-01T12:30:00.123456789Z`. A year outside 0000 to 9999 is
   * written as a sign and six digits, ISO 8601's expanded form and the one `Date#toISOString`
   * writes: `+275760-09-13T00:00:00Z`, `-271821-04-20T00:00:00Z`. {@link Instant.parse} reads it back.
   */
  toString(): string {
    const secondOfDay = floorMod(this.epochSecond, SECONDS_PER_DAY);
    const { year, month, day } = civilFromDays((this.epochSecond - secondOfDay) / SECONDS_PER_DAY);
    const hour = Math.floor(secondOfDay / 3600);
    const minute = Math.floor((secondOfDay % 3600) / 60);
    const second = secondOfDay % 60;
    const date = `${formatYear(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    return `${date}T${time}${formatFraction(this.nano)}Z`;
  }

  /**
   * The instant `seconds` seconds and `nanoOfSecond` nanoseconds (0-999 999 999) later, carrying a
   * nano sum past a whole second into the seconds.
   *
   * @throws {RangeError} when the result lies outside ±8.64e15 ms of the epoch.
   */
  private plus(seconds: number, nanoOfSecond: number): Instant {
    const nanoSum = this.nano + nanoOfSecond;
    const carry = nanoSum >= NANOS_PER_SECOND ? 1 : 0;
    const epochSecond = this.epochSecond + seconds + carry;
    const nano = nanoSum - carry * NANOS_PER_SECOND;
    assertInRange(epochSecond, nano);
    return new Instant(epochSecond, nano);
  }
}
