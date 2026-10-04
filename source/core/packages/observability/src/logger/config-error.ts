import { VipengeleError } from "@vipengele/ts-core-common";

/** The `code` every {@link LoggingConfigError} carries, and the only thing {@link isLoggingConfigError} matches on. */
export const LOGGING_CONFIG_ERROR_CODE = "observability.logger.config";

/** Raised when a logger's configuration is invalid. */
export class LoggingConfigError extends VipengeleError {
  readonly code = LOGGING_CONFIG_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link LoggingConfigError}.
 *
 * The check is the `code` string, not `value instanceof LoggingConfigError`. Two resolved copies
 * of this package in a consumer's dependency tree — differing peer ranges are enough — give the
 * same source two distinct class identities, so an identity check fails against an error raised
 * by the other copy. `instanceof Error` only rules out values that are not errors at all; it is
 * the `code` comparison that decides.
 */
export function isLoggingConfigError(value: unknown): value is LoggingConfigError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === LOGGING_CONFIG_ERROR_CODE;
}
