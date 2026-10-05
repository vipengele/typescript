import { type Clock, systemClock } from "../../time/clock";

/** The civil date and time of day an instant reads as on a wall clock in one time zone. */
export interface CivilDateTimeFields {
  /** The proleptic Gregorian year; 0 is 1 BC, -1 is 2 BC. */
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** The nanosecond of the second, a whole number of microseconds: the last three digits are zero. */
  readonly nanosecond: number;
}

/** The largest distance from the epoch, in milliseconds, an ECMAScript time value spans. */
const MAX_EPOCH_MILLISECONDS = 8.64e15;

/** The `Intl.DateTimeFormat` part types `civilNow` reads a number from. */
type NumericPart = "year" | "month" | "day" | "hour" | "minute" | "second";

/**
 * One formatter per time zone, built on first use. Locale and zone resolution are the expensive
 * part of building an `Intl.DateTimeFormat`; the zone is read on every call, so a change of zone
 * selects another entry rather than a stale formatter.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function resolveFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTER_CACHE.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The civil date and time of day `clock`'s current instant reads as in the runtime's time zone.
 *
 * The zone is read from `Intl.DateTimeFormat().resolvedOptions().timeZone` on every call, so a
 * change to the runtime's zone is seen by the next call. The conversion is `Intl`'s, in a fixed
 * locale with the Gregorian calendar, Latin digits and the `h23` hour cycle, so the fields do not
 * depend on the runtime's default locale and midnight is hour 0 rather than 24. The fraction of
 * the second comes from the instant itself, which `Intl` does not format.
 *
 * The clock reading is floored to the microsecond, never rounded, so the nanosecond's last three
 * digits are zero and an instant just before the epoch is in 1969, not 1970. The whole millisecond
 * is taken from the reading directly, so it is exact across the whole time value range; only the
 * sub-millisecond remainder is scaled, and it is floored to the microsecond within the resolution
 * the double reading itself carries.
 *
 * @throws {RangeError} when the clock returns a value that is not a finite time within
 *   ±8.64e15 milliseconds of the epoch.
 */
export function civilNow(clock: Clock = systemClock): CivilDateTimeFields {
  const reading = clock();
  const epochMilliseconds = Math.floor(reading);
  if (!(Math.abs(epochMilliseconds) <= MAX_EPOCH_MILLISECONDS)) {
    throw new RangeError(`The clock must return epoch milliseconds within ±${MAX_EPOCH_MILLISECONDS}, got ${epochMilliseconds}.`);
  }
  const parts = resolveFormatter(new Intl.DateTimeFormat().resolvedOptions().timeZone).formatToParts(epochMilliseconds);
  const fields: Partial<Record<NumericPart, number>> = {};
  let beforeCommonEra = false;
  for (const part of parts) {
    if (part.type === "era") {
      beforeCommonEra = part.value === "BC";
    } else if (part.type !== "literal") {
      fields[part.type as NumericPart] = Number(part.value);
    }
  }
  // The Gregorian year is formatted as a year of its era: 1 BC is year 1 of the BC era.
  const eraYear = fields.year as number;
  // The remainder is exact, but a reading a hair below a whole millisecond leaves one that rounds
  // to 1, which scales to 1000 µs; flooring puts such a reading in the millisecond's last microsecond.
  const microsecond = Math.min(Math.floor((reading - epochMilliseconds) * 1000), 999);
  const millisecondOfSecond = ((epochMilliseconds % 1000) + 1000) % 1000;
  return {
    year: beforeCommonEra ? 1 - eraYear : eraYear,
    month: fields.month as number,
    day: fields.day as number,
    hour: fields.hour as number,
    minute: fields.minute as number,
    second: fields.second as number,
    nanosecond: millisecondOfSecond * 1_000_000 + microsecond * 1000,
  };
}
