import { daysFromCivil } from "./civil";
import { Instant } from "./instant";
import type { LocalDateTime } from "./local-date-time";
import type { ZoneId } from "./zone-id";
import { type Disambiguation, disambiguate } from "./zone-resolve";

const SECONDS_PER_DAY = 86_400;

/** @throws {RangeError} when `amount` is not a safe integer. */
function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`The amount must be a safe integer, got ${amount}.`);
  }
}

/**
 * `amount` units of `unitSeconds` seconds each, as whole seconds. A product past the safe-integer
 * range is far outside any {@link Instant}'s range, so it is held at that range's edge, where
 * {@link Instant#plusSeconds} reports it as the out-of-range result it is rather than as an
 * unsafe amount.
 *
 * @throws {RangeError} when `amount` is not a safe integer.
 */
function toSeconds(amount: number, unitSeconds: number): number {
  assertAmount(amount);
  const seconds = amount * unitSeconds;
  return Number.isSafeInteger(seconds) ? seconds : Math.sign(seconds) * Number.MAX_SAFE_INTEGER;
}

/** How {@link ZonedDateTime.of} builds its value. */
export interface ZonedDateTimeOptions {
  /**
   * How a date and time of day the zone skips (a gap) or reads twice (an overlap) is settled.
   * `compatible` when omitted.
   */
  readonly disambiguation?: Disambiguation;
}

/**
 * A date and time of day in a named time zone, with the offset from UTC it reads in there: one
 * instant on the timeline, as the zone's wall clock shows it.
 *
 * The offset is in whole seconds east of Greenwich and carries seconds where the zone's rules do,
 * as a local mean time before the zone's first transition does. The date and time of day always
 * name the held instant in the zone, so a value built from a time the zone skips holds the shifted
 * time, not the one it was built from. Instances are frozen.
 *
 * This module touches {@link LocalDateTime} and {@link Instant} only when a method runs, never
 * while it evaluates, so either of them may import it back without the import cycle reading a
 * binding before it is initialised.
 */
export class ZonedDateTime {
  /** The wall-clock date and time of day in {@link ZonedDateTime#zone}. */
  private readonly local: LocalDateTime;
  /** The time zone. */
  readonly zone: ZoneId;
  /** The offset from UTC the date and time read in, in whole seconds, positive east of Greenwich. */
  readonly offsetSeconds: number;

  private constructor(local: LocalDateTime, zone: ZoneId, offsetSeconds: number) {
    this.local = local;
    this.zone = zone;
    this.offsetSeconds = offsetSeconds;
    Object.freeze(this);
  }

  /**
   * `localDateTime` in `zone`. A time the zone reads once takes that reading's offset; a time it
   * skips or reads twice is settled as `options.disambiguation` says, `compatible` by default: a
   * skipped time moves forward by the gap's length, and a time read twice takes the earlier
   * instant.
   *
   * @throws {ZoneResolutionError} when the disambiguation is `reject` and `localDateTime` falls in
   *   a gap or an overlap.
   * @throws {InvalidDateTimeError} when moving a time in a gap carries it outside 0001-01-01 to 9999-12-31.
   */
  static of(localDateTime: LocalDateTime, zone: ZoneId, options: ZonedDateTimeOptions = {}): ZonedDateTime {
    const { local, offsetSeconds } = disambiguate(localDateTime, zone, options.disambiguation);
    return new ZonedDateTime(local, zone, offsetSeconds);
  }

  /** `-1` when `a` is an earlier instant than `b`, `1` when a later one, and `0` when the same, to the nanosecond, whatever their zones. */
  static compare(a: ZonedDateTime, b: ZonedDateTime): number {
    return Instant.compare(a.toInstant(), b.toInstant());
  }

  /** Whether `other` is the same instant in the same zone. The same instant in another zone is not equal. */
  equals(other: ZonedDateTime): boolean {
    return ZonedDateTime.compare(this, other) === 0 && this.zone.equals(other.zone);
  }

  /** The wall-clock date and time of day in the zone, without the zone. */
  toLocalDateTime(): LocalDateTime {
    return this.local;
  }

  /** The instant the value names: its date and time of day read as UTC, less the offset, keeping the nanosecond. */
  toInstant(): Instant {
    const { date, time } = this.local;
    const localSeconds =
      daysFromCivil(date.year, date.month, date.day) * SECONDS_PER_DAY + time.hour * 3600 + time.minute * 60 + time.second;
    return Instant.ofEpochSecond(localSeconds - this.offsetSeconds, time.nanosecond);
  }

  /**
   * The value `days` days later on the zone's calendar at the same wall-clock time, re-read in the
   * zone as {@link ZonedDateTime.of} reads it under `options`; a negative `days` goes back. The
   * date moves, not the instant, so a day across a transition is not 24 elapsed hours: 23 across
   * a spring-forward and 25 across a fall-back. The arithmetic starts from the held date and time,
   * which for a value built in a gap is the shifted time.
   *
   * @throws {RangeError} when `days` is not a safe integer.
   * @throws {InvalidDateTimeError} when the date falls outside 0001-01-01 to 9999-12-31.
   * @throws {ZoneResolutionError} when the disambiguation is `reject` and the result falls in a gap
   *   or an overlap.
   */
  plusDays(days: number, options?: ZonedDateTimeOptions): ZonedDateTime {
    return ZonedDateTime.of(this.local.plusDays(days), this.zone, options);
  }

  /**
   * The value `days` days earlier on the zone's calendar at the same wall-clock time, with
   * {@link ZonedDateTime#plusDays}'s re-reading and errors. It undoes `plusDays` only when neither
   * end falls in a gap or an overlap.
   */
  minusDays(days: number, options?: ZonedDateTimeOptions): ZonedDateTime {
    return ZonedDateTime.of(this.local.minusDays(days), this.zone, options);
  }

  /**
   * The value `months` months later on the zone's calendar at the same wall-clock time, clamping
   * the day as {@link LocalDateTime#plusMonths} does, so January 31 plus one month is the last day of
   * February. The result is re-read in the zone as {@link ZonedDateTime.of} reads it under
   * `options`; a negative `months` goes back.
   *
   * @throws {RangeError} when `months` is not a safe integer.
   * @throws {InvalidDateTimeError} when the date falls outside 0001-01-01 to 9999-12-31.
   * @throws {ZoneResolutionError} when the disambiguation is `reject` and the result falls in a gap
   *   or an overlap.
   */
  plusMonths(months: number, options?: ZonedDateTimeOptions): ZonedDateTime {
    return ZonedDateTime.of(this.local.plusMonths(months), this.zone, options);
  }

  /**
   * The value `months` months earlier on the zone's calendar at the same wall-clock time, with
   * {@link ZonedDateTime#plusMonths}'s clamping, re-reading and errors.
   */
  minusMonths(months: number, options?: ZonedDateTimeOptions): ZonedDateTime {
    return ZonedDateTime.of(this.local.minusMonths(months), this.zone, options);
  }

  /**
   * The value `hours` hours of elapsed time later, in the same zone; a negative `hours` goes back.
   * The instant moves exactly, so the wall clock jumps by the transition's length across one.
   *
   * @throws {RangeError} when `hours` is not a safe integer, or the instant lies outside ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date in the zone falls outside 0001-01-01 to 9999-12-31.
   */
  plusHours(hours: number): ZonedDateTime {
    return this.toInstant().plusSeconds(toSeconds(hours, 3600)).atZone(this.zone);
  }

  /** The value `hours` hours of elapsed time earlier; the inverse of {@link ZonedDateTime#plusHours}, with its errors. */
  minusHours(hours: number): ZonedDateTime {
    return this.plusHours(-hours);
  }

  /**
   * The value `minutes` minutes of elapsed time later, in the same zone; a negative `minutes` goes
   * back. The instant moves exactly, so the wall clock jumps by the transition's length across one.
   *
   * @throws {RangeError} when `minutes` is not a safe integer, or the instant lies outside ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date in the zone falls outside 0001-01-01 to 9999-12-31.
   */
  plusMinutes(minutes: number): ZonedDateTime {
    return this.toInstant().plusSeconds(toSeconds(minutes, 60)).atZone(this.zone);
  }

  /** The value `minutes` minutes of elapsed time earlier; the inverse of {@link ZonedDateTime#plusMinutes}, with its errors. */
  minusMinutes(minutes: number): ZonedDateTime {
    return this.plusMinutes(-minutes);
  }

  /**
   * The value `seconds` seconds of elapsed time later, in the same zone; a negative `seconds` goes
   * back. The instant moves exactly, so the wall clock jumps by the transition's length across one.
   *
   * @throws {RangeError} when `seconds` is not a safe integer, or the instant lies outside ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date in the zone falls outside 0001-01-01 to 9999-12-31.
   */
  plusSeconds(seconds: number): ZonedDateTime {
    return this.toInstant().plusSeconds(seconds).atZone(this.zone);
  }

  /** The value `seconds` seconds of elapsed time earlier; the inverse of {@link ZonedDateTime#plusSeconds}, with its errors. */
  minusSeconds(seconds: number): ZonedDateTime {
    return this.plusSeconds(-seconds);
  }

  /**
   * The value `nanos` nanoseconds of elapsed time later, in the same zone; a negative `nanos` goes
   * back. The instant moves exactly, so the wall clock jumps by the transition's length across one.
   *
   * @throws {RangeError} when `nanos` is not a safe integer, or the instant lies outside ±8.64e15 ms of the epoch.
   * @throws {InvalidDateTimeError} when the date in the zone falls outside 0001-01-01 to 9999-12-31.
   */
  plusNanos(nanos: number): ZonedDateTime {
    return this.toInstant().plusNanos(nanos).atZone(this.zone);
  }

  /** The value `nanos` nanoseconds of elapsed time earlier; the inverse of {@link ZonedDateTime#plusNanos}, with its errors. */
  minusNanos(nanos: number): ZonedDateTime {
    return this.plusNanos(-nanos);
  }
}
