import { VipengeleError } from "@vipengele/ts-core-common";

/** The `code` every {@link HttpTransportConfigError} carries, and the only thing {@link isHttpTransportConfigError} matches on. */
export const HTTP_TRANSPORT_CONFIG_ERROR_CODE = "observability.errors.http-transport.config";

/** Raised when an HTTP transport's configuration is invalid. */
export class HttpTransportConfigError extends VipengeleError {
  readonly code = HTTP_TRANSPORT_CONFIG_ERROR_CODE;
}

/**
 * Narrows `value` to an {@link HttpTransportConfigError}.
 *
 * The check is the `code` string, not `value instanceof HttpTransportConfigError`. Two resolved
 * copies of this package in a consumer's dependency tree — differing peer ranges are enough — give
 * the same source two distinct class identities, so an identity check fails against an error raised
 * by the other copy. `instanceof Error` only rules out values that are not errors at all; it is
 * the `code` comparison that decides.
 */
export function isHttpTransportConfigError(value: unknown): value is HttpTransportConfigError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === HTTP_TRANSPORT_CONFIG_ERROR_CODE;
}
