import { VipengeleError } from "@vipengele/ts-core-common";
import { redactUrl } from "@vipengele/ts-core-redaction";

/** Every {@link HttpError} code starts with this prefix, and {@link isHttpError} matches on it. */
const HTTP_CODE_PREFIX = "http.";

/** The `code` every {@link HttpStatusError} carries. */
export const HTTP_STATUS_ERROR_CODE = "http.status";

/** The `code` every {@link HttpConfigError} carries. */
export const HTTP_CONFIG_ERROR_CODE = "http.config";

/** The `code` every {@link OAuth2TokenRefusedError} carries. */
export const OAUTH2_TOKEN_REFUSED_ERROR_CODE = "http.oauth2-token-refused";

/** The `code` every {@link OAuth2TokenError} carries. */
export const OAUTH2_TOKEN_ERROR_CODE = "http.oauth2-token";

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
    const url = redactTokenUrl(details.url);
    super(`${method} ${url} → ${response.status}`, options);
    this.method = method;
    this.url = url;
    this.status = response.status;
    Object.defineProperty(this, "response", { value: response, enumerable: false, writable: false });
  }
}

const redactTokenUrl = (url: string | URL): string => redactUrl(typeof url === "string" ? url : url.href);

/** What an {@link OAuth2TokenRefusedError} reports about the refused token request. */
export type OAuth2TokenRefusedErrorDetails = {
  /** The token endpoint URL; any userinfo and secret query parameters are redacted before it is stored. */
  readonly tokenUrl: string | URL;
  /** The status the token endpoint answered with, 400 or 401. */
  readonly status: number;
  /** The OAuth `error` code from the response body, when it carried one. `error_description` is never kept. */
  readonly error?: string;
};

/** Raised when the token endpoint refuses a token request with a 400 or 401. */
export class OAuth2TokenRefusedError extends HttpError {
  readonly code = OAUTH2_TOKEN_REFUSED_ERROR_CODE;

  /** The token endpoint URL with userinfo and secret query parameters redacted. */
  readonly tokenUrl: string;

  /** The response status code. */
  readonly status: number;

  /** The OAuth `error` code the endpoint answered with, when it sent one. */
  readonly error: string | undefined;

  constructor(details: OAuth2TokenRefusedErrorDetails, options?: ErrorOptions) {
    const tokenUrl = redactTokenUrl(details.tokenUrl);
    super(`OAuth2 token request to ${tokenUrl} refused → ${details.status}`, options);
    this.tokenUrl = tokenUrl;
    this.status = details.status;
    this.error = details.error;
  }
}

/** What an {@link OAuth2TokenError} reports about the failed token acquisition. */
export type OAuth2TokenErrorDetails = {
  /** The token endpoint URL; any userinfo and secret query parameters are redacted before it is stored. */
  readonly tokenUrl: string | URL;
  /** A fixed description of the failure; it never carries a token, a secret or response content. */
  readonly reason: string;
  /** The status the token endpoint answered with, when it answered. */
  readonly status?: number;
};

/**
 * Raised when a token cannot be acquired for any reason other than a 400 or 401 refusal.
 *
 * `cause` is kept only for a thrown transport error or an error from a custom token source; a
 * malformed or invalid response carries none, since a parse or header error can quote the value.
 */
export class OAuth2TokenError extends HttpError {
  readonly code = OAUTH2_TOKEN_ERROR_CODE;

  /** The token endpoint URL with userinfo and secret query parameters redacted. */
  readonly tokenUrl: string;

  /** The response status code, when the endpoint answered. */
  readonly status: number | undefined;

  constructor(details: OAuth2TokenErrorDetails, options?: ErrorOptions) {
    const tokenUrl = redactTokenUrl(details.tokenUrl);
    const status = details.status === undefined ? "" : ` → ${details.status}`;
    super(`OAuth2 token request to ${tokenUrl} failed: ${details.reason}${status}`, options);
    this.tokenUrl = tokenUrl;
    this.status = details.status;
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

/** Narrows `value` to an {@link OAuth2TokenRefusedError}; matches on `code`, not class identity. */
export function isOAuth2TokenRefusedError(value: unknown): value is OAuth2TokenRefusedError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === OAUTH2_TOKEN_REFUSED_ERROR_CODE;
}

/** Narrows `value` to an {@link OAuth2TokenError}; matches on `code`, not class identity. */
export function isOAuth2TokenError(value: unknown): value is OAuth2TokenError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === OAUTH2_TOKEN_ERROR_CODE;
}
