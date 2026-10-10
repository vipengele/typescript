import { VipengeleError } from "@vipengele/ts-core-common";

/** The `code` every {@link ReporterConfigError} carries, and the only thing {@link isReporterConfigError} matches on. */
export const REPORTER_CONFIG_ERROR_CODE = "observability.errors.config";

/** Raised when a Reporter's configuration is invalid. */
export class ReporterConfigError extends VipengeleError {
  readonly code = REPORTER_CONFIG_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link ReporterConfigError}.
 *
 * The check is the `code` string, not `value instanceof ReporterConfigError`. Two resolved copies
 * of this package in a consumer's dependency tree — differing peer ranges are enough — give the
 * same source two distinct class identities, so an identity check fails against an error raised
 * by the other copy. `instanceof Error` only rules out values that are not errors at all; it is
 * the `code` comparison that decides.
 */
export function isReporterConfigError(value: unknown): value is ReporterConfigError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === REPORTER_CONFIG_ERROR_CODE;
}
