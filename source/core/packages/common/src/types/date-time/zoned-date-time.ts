import { daysFromCivil } from "./civil";
import { Instant } from "./instant";
import type { LocalDateTime } from "./local-date-time";
import type { ZoneId } from "./zone-id";
import { type Disambiguation, disambiguate } from "./zone-resolve";

const SECONDS_PER_DAY = 86_400;

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
}
