import { civilFromDays, daysFromCivil } from "./civil";
import { ZoneResolutionError } from "./errors";
import { Instant } from "./instant";
import { LocalDateTime } from "./local-date-time";
import type { ZoneId } from "./zone-id";

const SECONDS_PER_DAY = 86_400;

/**
 * How a date and time of day that does not name exactly one instant in a zone is settled.
 *
 * - `compatible` follows `java.time`: a time in a gap moves forward by the gap's length and takes
 *   the offset after it; a time in an overlap takes the offset before it, the earlier instant.
 * - `earlier` takes the offset before the transition: a time in a gap moves back by the gap's
 *   length, and a time in an overlap reads as the earlier instant.
 * - `later` takes the offset after the transition: a time in a gap moves forward by the gap's
 *   length, and a time in an overlap reads as the later instant.
 * - `reject` throws a {@link ZoneResolutionError} for a time in a gap or an overlap.
 *
 * A time that names exactly one instant resolves to it under every mode.
 */
export type Disambiguation = "compatible" | "earlier" | "later" | "reject";

/**
 * How many instants a date and time of day names in a zone, with the offsets that decide it, in
 * whole seconds east of Greenwich.
 *
 * - `unique`: exactly one, read with `offsetSeconds`.
 * - `gap`: none; the zone skips the time, moving from `offsetBefore` to the larger `offsetAfter`.
 * - `overlap`: two; the zone reads the time twice, first with `offsetBefore` (the earlier instant)
 *   and then with the smaller `offsetAfter` (the later one).
 */
export type ZoneResolution =
  | { readonly kind: "unique"; readonly offsetSeconds: number }
  | { readonly kind: "gap" | "overlap"; readonly offsetBefore: number; readonly offsetAfter: number };

/** A date and time of day that names exactly one instant in a zone, with the offset it reads in there. */
export interface ResolvedLocal {
  readonly local: LocalDateTime;
  readonly offsetSeconds: number;
}

/** Seconds from 1970-01-01T00:00:00 to `local`'s date and time, read as UTC, ignoring the fraction. */
function localSeconds(local: LocalDateTime): number {
  const { date, time } = local;
  return daysFromCivil(date.year, date.month, date.day) * SECONDS_PER_DAY + time.hour * 3600 + time.minute * 60 + time.second;
}

/** `zone`'s offset at the instant `epochSecond` seconds after the epoch. */
function offsetAt(zone: ZoneId, epochSecond: number): number {
  return zone.offsetSecondsAt(Instant.ofEpochSecond(epochSecond));
}

/**
 * `local` moved by `seconds` whole seconds, keeping its nanosecond.
 *
 * @throws {InvalidDateTimeError} when the result falls outside 0001-01-01 to 9999-12-31.
 */
function shift(local: LocalDateTime, seconds: number): LocalDateTime {
  const total = localSeconds(local) + seconds;
  const secondOfDay = ((total % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const { year, month, day } = civilFromDays((total - secondOfDay) / SECONDS_PER_DAY);
  return LocalDateTime.ofFields(
    year,
    month,
    day,
    Math.floor(secondOfDay / 3600),
    Math.floor((secondOfDay % 3600) / 60),
    secondOfDay % 60,
    local.time.nanosecond,
  );
}

/**
 * How many instants `local` names in `zone`.
 *
 * The candidate offsets are the zone's offsets a day before and a day after `local` read as UTC,
 * which bracket any transition near it, whatever the transition's size. An offset `off` is kept
 * when the instant `local - off` reads in `zone` with that same offset: none kept is a gap, one is
 * a unique time, two an overlap. Offsets change on whole seconds, so the fraction of the second
 * never moves `local` across a transition and is not consulted.
 */
export function resolveLocal(local: LocalDateTime, zone: ZoneId): ZoneResolution {
  const seconds = localSeconds(local);
  const offsetBefore = offsetAt(zone, seconds - SECONDS_PER_DAY);
  const offsetAfter = offsetAt(zone, seconds + SECONDS_PER_DAY);
  const candidates = offsetBefore === offsetAfter ? [offsetBefore] : [offsetBefore, offsetAfter];
  const kept = candidates.filter((offset) => offsetAt(zone, seconds - offset) === offset);
  if (kept.length === 1) {
    return { kind: "unique", offsetSeconds: kept[0] as number };
  }
  return { kind: kept.length === 0 ? "gap" : "overlap", offsetBefore, offsetAfter };
}

/**
 * The instant `local` names in `zone`, as a date and time of day and the offset it reads in
 * there, settling a gap or an overlap as `mode` says. A time in a gap moves by the gap's length,
 * `offsetAfter - offsetBefore`, so it lands on the instant `local` reads as in the offset on the
 * other side; its nanosecond is kept.
 *
 * @throws {ZoneResolutionError} when `mode` is `reject` and `local` falls in a gap or an overlap.
 * @throws {InvalidDateTimeError} when moving a time in a gap carries it outside 0001-01-01 to 9999-12-31.
 */
export function disambiguate(local: LocalDateTime, zone: ZoneId, mode: Disambiguation = "compatible"): ResolvedLocal {
  const resolution = resolveLocal(local, zone);
  if (resolution.kind === "unique") {
    return { local, offsetSeconds: resolution.offsetSeconds };
  }
  if (mode === "reject") {
    const reason = resolution.kind === "gap" ? "does not exist" : "is ambiguous";
    throw new ZoneResolutionError(`The local date-time ${local} ${reason} in ${zone}.`);
  }
  const { offsetBefore, offsetAfter } = resolution;
  const takeAfter = mode === "later" || (mode === "compatible" && resolution.kind === "gap");
  const offsetSeconds = takeAfter ? offsetAfter : offsetBefore;
  if (resolution.kind === "overlap") {
    return { local, offsetSeconds };
  }
  // The instant is `local` read in the offset not taken; re-read in `offsetSeconds`, it is that
  // instant's wall-clock time.
  const otherOffset = takeAfter ? offsetBefore : offsetAfter;
  return { local: shift(local, offsetSeconds - otherOffset), offsetSeconds };
}
