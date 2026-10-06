import { VipengeleError } from "../../errors/vipengele-error";

/** The `code` every {@link InvalidDateTimeError} carries, and the only thing {@link isInvalidDateTimeError} matches on. */
const INVALID_DATE_TIME_ERROR_CODE = "common.date-time.invalid";

/** The `code` every {@link DateTimeParseError} carries, and the only thing {@link isDateTimeParseError} matches on. */
const DATE_TIME_PARSE_ERROR_CODE = "common.date-time.parse";

/** The `code` every {@link UnknownZoneError} carries, and the only thing {@link isUnknownZoneError} matches on. */
const UNKNOWN_ZONE_ERROR_CODE = "common.date-time.unknown-zone";

/** The `code` every {@link ZoneResolutionError} carries, and the only thing {@link isZoneResolutionError} matches on. */
const ZONE_RESOLUTION_ERROR_CODE = "common.date-time.zone-resolution";

/**
 * Raised when a date or time is built from fields that do not name one: a month outside 1-12, a
 * day past the end of its month, a non-integer field. Construction never rolls an overflowing
 * field into the next unit, so February 30 is an error rather than March 2.
 */
export class InvalidDateTimeError extends VipengeleError {
  readonly code = INVALID_DATE_TIME_ERROR_CODE;
}

/**
 * Raised when a string is not the ISO 8601 form of a date or time, including a well-shaped string
 * whose fields do not name one, such as `2026-02-30`.
 */
export class DateTimeParseError extends VipengeleError {
  readonly code = DATE_TIME_PARSE_ERROR_CODE;
}

/**
 * Raised when a string does not name a time zone: one `Intl` does not recognize, an empty string,
 * or a fixed UTC offset such as `+05:30` or `Z`, which is an offset rather than a named zone.
 */
export class UnknownZoneError extends VipengeleError {
  readonly code = UNKNOWN_ZONE_ERROR_CODE;
}

/**
 * Raised when a date and time of day does not name exactly one instant in a time zone and the
 * caller asked for that to be refused: a wall-clock time the zone skips in a gap, or one it reads
 * twice in an overlap.
 */
export class ZoneResolutionError extends VipengeleError {
  readonly code = ZONE_RESOLUTION_ERROR_CODE;
}

/** The outcome of a date or time `tryParse`. `value` is present exactly when `success` is `true`. */
export interface DateTimeTryParseResult<T> {
  /** Whether the string spelled a value of the type. */
  readonly success: boolean;
  /** The parsed value, on success. */
  readonly value?: T;
}

/**
 * Narrows `value` to an {@link InvalidDateTimeError}.
 *
 * The check is the `code` string, not a class identity: two resolved copies of this package give
 * the same source two distinct classes, so an identity check fails against an error raised by the
 * other copy. `instanceof Error` only rules out values that are not errors at all; it is the
 * `code` comparison that decides.
 */
export function isInvalidDateTimeError(value: unknown): value is InvalidDateTimeError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === INVALID_DATE_TIME_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link DateTimeParseError}. Matches on the `code` string for the reason
 * {@link isInvalidDateTimeError} gives.
 */
export function isDateTimeParseError(value: unknown): value is DateTimeParseError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === DATE_TIME_PARSE_ERROR_CODE;
}

/**
 * Narrows `value` to an {@link UnknownZoneError}. Matches on the `code` string for the reason
 * {@link isInvalidDateTimeError} gives.
 */
export function isUnknownZoneError(value: unknown): value is UnknownZoneError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === UNKNOWN_ZONE_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link ZoneResolutionError}. Matches on the `code` string for the reason
 * {@link isInvalidDateTimeError} gives.
 */
export function isZoneResolutionError(value: unknown): value is ZoneResolutionError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === ZONE_RESOLUTION_ERROR_CODE;
}
