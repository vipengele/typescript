import { VipengeleError } from "../../errors/vipengele-error";

/** The `code` every {@link NumericParseError} carries, and the only thing {@link isNumericParseError} matches on. */
const NUMERIC_PARSE_ERROR_CODE = "common.numeric.parse";

/** Raised when a string does not spell a number in the locale it is read under. */
export class NumericParseError extends VipengeleError {
  readonly code = NUMERIC_PARSE_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link NumericParseError}.
 *
 * The check is the `code` string, not `value instanceof NumericParseError`. Two resolved copies
 * of this package in a consumer's dependency tree — differing peer ranges are enough — give the
 * same source two distinct class identities, so an identity check fails against an error raised
 * by the other copy. `instanceof Error` only rules out values that are not errors at all; it is
 * the `code` comparison that decides.
 */
export function isNumericParseError(value: unknown): value is NumericParseError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === NUMERIC_PARSE_ERROR_CODE;
}
