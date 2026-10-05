import { type Clock, systemClock } from "../../time/clock";
import { type CivilDateTimeFields, civilFieldsAt } from "./civil-fields";

export type { CivilDateTimeFields } from "./civil-fields";

/** The largest distance from the epoch, in milliseconds, an ECMAScript time value spans. */
const MAX_EPOCH_MILLISECONDS = 8.64e15;

/**
 * The civil date and time of day `clock`'s current instant reads as in the runtime's time zone.
 *
 * The zone is read from `Intl.DateTimeFormat().resolvedOptions().timeZone` on every call, so a
 * change to the runtime's zone is seen by the next call, and the conversion is `civilFieldsAt`'s:
 * a fixed locale, the Gregorian calendar and the `h23` hour cycle, with the fraction of the second
 * taken from the reading itself.
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
  return civilFieldsAt(new Intl.DateTimeFormat().resolvedOptions().timeZone, reading);
}
