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

/** The `Intl.DateTimeFormat` part types `civilFieldsAt` reads a number from. */
type NumericPart = "year" | "month" | "day" | "hour" | "minute" | "second";

/**
 * One formatter per time zone, built on first use. Locale and zone resolution are the expensive
 * part of building an `Intl.DateTimeFormat`, so every caller converting at a zone shares its entry.
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
 * The civil date and time of day the instant `epochMilliseconds` reads as in the named `timeZone`.
 *
 * The conversion is `Intl`'s, in a fixed locale with the Gregorian calendar, Latin digits and the
 * `h23` hour cycle, so the fields do not depend on the runtime's default locale and midnight is
 * hour 0 rather than 24. The year is any proleptic Gregorian year the time value range reaches, not
 * only 1 to 9999, and an instant before a zone's first transition reads in its local mean time. The
 * fraction of the second comes from the instant itself, which `Intl` does not format.
 *
 * The instant is floored to the microsecond, never rounded, so the nanosecond's last three digits
 * are zero and an instant just before the epoch is in 1969, not 1970. The whole millisecond is
 * taken from the instant directly, so it is exact across the whole time value range; only the
 * sub-millisecond remainder is scaled, and it is floored to the microsecond within the resolution
 * the double itself carries.
 *
 * @throws {RangeError} when `epochMilliseconds` is not a finite time within ±8.64e15 milliseconds
 *   of the epoch, or `timeZone` is not a time zone `Intl` recognizes.
 */
export function civilFieldsAt(timeZone: string, epochMilliseconds: number): CivilDateTimeFields {
  const wholeMilliseconds = Math.floor(epochMilliseconds);
  const parts = resolveFormatter(timeZone).formatToParts(wholeMilliseconds);
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
  // The remainder is exact, but an instant a hair below a whole millisecond leaves one that rounds
  // to 1, which scales to 1000 µs; flooring puts such an instant in the millisecond's last microsecond.
  const microsecond = Math.min(Math.floor((epochMilliseconds - wholeMilliseconds) * 1000), 999);
  const millisecondOfSecond = ((wholeMilliseconds % 1000) + 1000) % 1000;
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
