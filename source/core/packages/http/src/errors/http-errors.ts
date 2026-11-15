import { VipengeleError } from "@vipengele/ts-core-common";
import { redactUrl } from "@vipengele/ts-core-redaction";

/** Every {@link HttpError} code starts with this prefix, and {@link isHttpError} matches on it. */
const HTTP_CODE_PREFIX = "http.";

/** The `code` every {@link HttpStatusError} carries. */
export const HTTP_STATUS_ERROR_CODE = "http.status";

/** The `code` every {@link HttpConfigError} carries. */
export const HTTP_CONFIG_ERROR_CODE = "http.config";

/** The base of every error this package raises; each concrete error fixes its own `http.*` code. */
export abstract class HttpError extends VipengeleError {}

/** Raised when a client's configuration is invalid. */
export class HttpConfigError extends HttpError {
  readonly code = HTTP_CONFIG_ERROR_CODE;
}

/** What an {@link HttpStatusError} reports about the exchange that produced the status. */
export type HttpStatusErrorDetails = {
  /** The request method. */
  readonly method: string;
  /** The request URL; any userinfo and secret query parameters are redacted before it is stored. */
  readonly url: string | URL;
  /** The response; its `status` becomes the error's `status`. */
  readonly response: Response;
};

/** Raised when a response carries a status the caller treats as a failure. */
export class HttpStatusError extends HttpError {
  readonly code = HTTP_STATUS_ERROR_CODE;

  /** The request method. */
  readonly method: string;

  /** The request URL with userinfo and secret query parameters redacted. */
  readonly url: string;

  /** The response status code. */
  readonly status: number;

  /** The response. Non-enumerable, so serializing or logging the error never walks into the response. */
  declare readonly response: Response;

  constructor(details: HttpStatusErrorDetails, options?: ErrorOptions) {
    const { method, response } = details;
    const url = redactUrl(typeof details.url === "string" ? details.url : details.url.href);
    super(`${method} ${url} → ${response.status}`, options);
    this.method = method;
    this.url = url;
    this.status = response.status;
    Object.defineProperty(this, "response", { value: response, enumerable: false, writable: false });
  }
}

/**
 * Narrows `value` to any error this package raises.
 *
 * Matches the `http.` prefix of `code`, so a new concrete error is covered without touching the
 * guard. Like every guard here it never uses `instanceof` on a package class: two resolved copies
 * of the package give the same source two class identities.
 */
export function isHttpError(value: unknown): value is HttpError {
  if (!(value instanceof Error)) {
    return false;
  }
  const { code } = value as Partial<VipengeleError>;
  return typeof code === "string" && code.startsWith(HTTP_CODE_PREFIX);
}

/** Narrows `value` to an {@link HttpStatusError}; matches on `code`, not class identity. */
export function isHttpStatusError(value: unknown): value is HttpStatusError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === HTTP_STATUS_ERROR_CODE;
}

/** Narrows `value` to an {@link HttpConfigError}; matches on `code`, not class identity. */
export function isHttpConfigError(value: unknown): value is HttpConfigError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === HTTP_CONFIG_ERROR_CODE;
}
