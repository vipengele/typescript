import type { Clock } from "@vipengele/ts-core-common";
import type { HttpFetch } from "../context";

/** A bearer token and, when the issuer said how long it lives, when it stops being valid. */
export type OAuth2Token = {
  /** The access token, sent as `Authorization: Bearer <accessToken>`. */
  readonly accessToken: string;
  /** Epoch milliseconds, on the clock the request carried, after which the token is stale. Absent: valid until the server rejects it. */
  readonly expiresAt?: number;
};

/** What a {@link OAuth2TokenSource} is given to acquire a token. */
export type OAuth2TokenRequest = {
  /** The fetch the token request goes through. */
  readonly fetch: HttpFetch;
  /** Aborted when the refresh deadline passes; the token request must honour it. */
  readonly signal: AbortSignal;
  /** The clock `expiresAt` is measured on, shared with the staleness check. */
  readonly clock: Clock;
  /** Why a token is wanted: none held yet, the held one is stale, or the server rejected it. */
  readonly reason: "initial" | "expired" | "rejected";
};

/** Acquires a token; `clientCredentials` is the built-in implementation. */
export interface OAuth2TokenSource {
  getToken(request: OAuth2TokenRequest): Promise<OAuth2Token>;
}

/** Where a filter keeps the token it holds; a store may be shared between filters. */
export interface OAuth2TokenStore {
  get(): OAuth2Token | undefined;
  set(token: OAuth2Token): void;
}
