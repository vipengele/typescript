import { daysFromCivil } from "./civil";
import { type CivilDateTimeFields, civilFieldsAt } from "./civil-fields";
import { UnknownZoneError } from "./errors";
import type { Instant } from "./instant";

const MILLIS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 86_400;

/**
 * A fixed UTC offset rather than a zone name: a sign followed by digits and colons (`+05:30`,
 * `+0530`, `-08`), or `Z`. `Intl` accepts offset time zones, but an offset has no rules of its own.
 */
const OFFSET_PATTERN = /^(?:[+-][\d:]*|z)$/i;

/** Seconds from 1970-01-01T00:00:00 to the civil date and time `fields` reads as, ignoring the fraction. */
function civilSeconds(fields: CivilDateTimeFields): number {
  return daysFromCivil(fields.year, fields.month, fields.day) * SECONDS_PER_DAY + fields.hour * 3600 + fields.minute * 60 + fields.second;
}

/**
 * A named time zone from the IANA database, such as `Europe/Berlin`, as the runtime's `Intl`
 * knows it. Instances are frozen.
 *
 * The {@link ZoneId#id} is `Intl`'s canonical spelling of the name, so two spellings `Intl` treats
 * as one zone give equal ids. The canonical spelling is the runtime's own and depends on its ICU
 * version: a legacy alias resolves to whatever zone that version links it to (`EST` reads as
 * `America/Panama` on Node 22), `Etc/UTC` may read as `UTC` or `Etc/UTC`, and a renamed zone may
 * read under either name.
 */
export class ZoneId {
  /** `Intl`'s canonical spelling of the zone's name. */
  readonly id: string;

  private constructor(id: string) {
    this.id = id;
    Object.freeze(this);
  }

  /**
   * The zone `id` names, matched case-insensitively. Any name `Intl` accepts is a zone, legacy
   * aliases such as `UTC`, `GMT` and `EST` included.
   *
   * @throws {UnknownZoneError} when `id` is empty, is a name `Intl` does not recognize, or is a
   *   fixed UTC offset such as `+05:30` or `Z`.
   */
  static of(id: string): ZoneId {
    if (OFFSET_PATTERN.test(id)) {
      throw new UnknownZoneError(`A time zone must be a zone name, not a UTC offset, got "${id}".`);
    }
    let canonical: string;
    try {
      canonical = new Intl.DateTimeFormat("en-US", { timeZone: id }).resolvedOptions().timeZone;
    } catch {
      throw new UnknownZoneError(`Unknown time zone "${id}".`);
    }
    return new ZoneId(canonical);
  }

  /**
   * The runtime's time zone, read from `Intl.DateTimeFormat().resolvedOptions().timeZone` on every
   * call, so a change to the runtime's zone is seen by the next call.
   */
  static systemDefault(): ZoneId {
    return new ZoneId(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  /** Whether `other` is the same zone, by canonical id. */
  equals(other: ZoneId): boolean {
    return this.id === other.id;
  }

  /**
   * The zone's offset from UTC at `instant`, in whole seconds, positive east of Greenwich. An
   * instant before the zone's first transition reads in its local mean time, which carries
   * seconds: Berlin in 1880 is +00:53:28, 3208 seconds.
   *
   * The offset is the difference between the civil date and time the instant reads as in the zone
   * and in UTC, counted in days by integer calendar arithmetic, so it holds for every instant in
   * range, years before 1 and after 9999 included. The fraction of the second is ignored; offsets
   * change on whole seconds.
   */
  offsetSecondsAt(instant: Instant): number {
    const epochMilliseconds = instant.toEpochSecond() * MILLIS_PER_SECOND;
    return civilSeconds(civilFieldsAt(this.id, epochMilliseconds)) - civilSeconds(civilFieldsAt("UTC", epochMilliseconds));
  }

  /** The zone's {@link ZoneId#id}. */
  toString(): string {
    return this.id;
  }
}
