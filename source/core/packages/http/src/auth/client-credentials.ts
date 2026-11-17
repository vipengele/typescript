import { HttpConfigError, OAuth2TokenError, OAuth2TokenRefusedError } from "../errors/http-errors";
import { resolveUrl } from "../url";
import type { OAuth2Token, OAuth2TokenRequest, OAuth2TokenSource } from "./token";

/** Options for {@link clientCredentials}. */
export type ClientCredentialsOptions = {
  /** The absolute token endpoint URL; it must not carry userinfo. */
  readonly tokenUrl: string | URL;
  /** The client identifier; never empty. */
  readonly clientId: string;
  /** The client secret. */
  readonly clientSecret: string;
  /** The requested scope; an array is joined with spaces. */
  readonly scope?: string | readonly string[];
  /** Extra form parameters, such as `audience`; the grant, scope and credential parameters win over a same-named entry. */
  readonly params?: Readonly<Record<string, string>>;
  /**
   * How the client authenticates: `"basic"` (default) sends an `Authorization: Basic` header
   * (RFC 6749 section 2.3.1), `"body"` sends `client_id` and `client_secret` as form parameters.
   */
  readonly authentication?: "basic" | "body";
};

const REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 401]);

/** Form-urlencodes one value the way RFC 6749 section 2.3.1 asks of the id and the secret. */
function formEncode(value: string): string {
  return new URLSearchParams([["", value]]).toString().slice(1);
}

/** UTF-8 bytes of `value` as base64. */
function base64Utf8(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

/**
 * A token source for the OAuth2 client-credentials grant.
 *
 * A response without `expires_in` gives a token with no `expiresAt`. One with `expires_in` must
 * carry a finite number above zero (a numeric string counts) or the source fails. A `token_type`
 * other than `Bearer`, compared case-insensitively, fails; an absent `token_type` is read as
 * `Bearer`, since the only thing the filter does with the token is send it as one.
 *
 * Every failure message carries the redacted token URL and a fixed phrase, never response
 * content, the secret or a token.
 *
 * @throws HttpConfigError when `tokenUrl` is not an absolute URL or carries userinfo, or when
 *   `clientId` is empty.
 */
export function clientCredentials(options: ClientCredentialsOptions): OAuth2TokenSource {
  const { clientId, clientSecret, scope, params, authentication = "basic" } = options;
  const tokenUrl = resolveUrl(options.tokenUrl);
  if (clientId === "") {
    throw new HttpConfigError("clientCredentials needs a non-empty clientId");
  }

  const fail = (reason: string, status?: number): OAuth2TokenError =>
    new OAuth2TokenError({ tokenUrl, reason, ...(status === undefined ? {} : { status }) });

  const buildInit = (request: OAuth2TokenRequest): RequestInit => {
    const body = new URLSearchParams(params);
    body.set("grant_type", "client_credentials");
    if (scope !== undefined) {
      body.set("scope", typeof scope === "string" ? scope : scope.join(" "));
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (authentication === "basic") {
      headers.authorization = `Basic ${base64Utf8(`${formEncode(clientId)}:${formEncode(clientSecret)}`)}`;
    } else {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }
    return { method: "POST", headers, body, signal: request.signal };
  };

  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return JSON.parse(await response.text());
    } catch {
      // A body that is unreadable or not JSON has no usable content; the platform error can quote it.
      return undefined;
    }
  };

  const expiresAtOf = (expiresIn: unknown, now: number): number | undefined => {
    if (expiresIn === undefined) {
      return undefined;
    }
    const seconds = typeof expiresIn === "string" && expiresIn.trim() !== "" ? Number(expiresIn) : expiresIn;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      throw fail("invalid expires_in");
    }
    return now + seconds * 1000;
  };

  return {
    async getToken(request) {
      let response: Response;
      try {
        response = await request.fetch(tokenUrl.href, buildInit(request));
      } catch (cause) {
        throw new OAuth2TokenError({ tokenUrl, reason: "the request failed" }, { cause });
      }

      if (REFUSAL_STATUSES.has(response.status)) {
        const payload = await readJson(response);
        const code = (payload as { error?: unknown } | null | undefined)?.error;
        throw new OAuth2TokenRefusedError({
          tokenUrl,
          status: response.status,
          ...(typeof code === "string" ? { error: code } : {}),
        });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw fail("unexpected status", response.status);
      }

      const payload = await readJson(response);
      if (typeof payload !== "object" || payload === null) {
        throw fail("the response is not a JSON object");
      }
      const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn } = payload as Record<string, unknown>;
      if (typeof accessToken !== "string" || accessToken === "") {
        throw fail("the response has no access_token");
      }
      if (tokenType !== undefined && (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer")) {
        throw fail("the token_type is not Bearer");
      }
      const expiresAt = expiresAtOf(expiresIn, request.clock());
      const token: OAuth2Token = expiresAt === undefined ? { accessToken } : { accessToken, expiresAt };
      return token;
    },
  };
}
