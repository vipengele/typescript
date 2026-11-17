import { serializeError } from "@vipengele/ts-core-common/serialization";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import type { HttpFetch } from "../context";
import {
  isHttpConfigError,
  isOAuth2TokenError,
  isOAuth2TokenRefusedError,
  type OAuth2TokenError,
  type OAuth2TokenRefusedError,
} from "../errors/http-errors";
import { clientCredentials } from "./client-credentials";
import * as barrel from "./index";
import type { OAuth2TokenRequest } from "./token";

const TOKEN_URL = "https://auth.test/oauth/token";
const START = Date.parse("2040-01-01T00:00:00Z");
const clientSecret = ["s3", "cr3t"].join("-");
const accessToken = ["tok", "en", "value"].join("-");

type Call = { input: string; init: RequestInit };

/** A fetch answering each call with the next response in `replies`, the last one repeating, and recording every call. */
function scriptedFetch(...replies: Array<() => Response>): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (input, init) => {
    calls.push({ input, init });
    return (replies[Math.min(calls.length, replies.length) - 1] as () => Response)();
  };
  return { fetch, calls };
}

const json =
  (payload: unknown, status = 200): (() => Response) =>
  () =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

const ok = (extra: Record<string, unknown> = {}) => json({ access_token: accessToken, token_type: "Bearer", ...extra });

function requestOf(fetch: HttpFetch, signal: AbortSignal = new AbortController().signal): OAuth2TokenRequest {
  const time = createManualTime(START);
  return { fetch, signal, clock: time.clock, reason: "initial" };
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

function configErrorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

/** The whole serialized chain of `error`, where a leaked secret or token would show. */
const serialized = (error: unknown): string => JSON.stringify(serializeError(error));

function expectNoLeak(error: unknown): void {
  const text = serialized(error);
  expect(text).not.toContain(clientSecret);
  expect(text).not.toContain(accessToken);
}

const basicHeader = (call: Call): string => (call.init.headers as Record<string, string>).authorization as string;
const bodyOf = (call: Call): URLSearchParams => call.init.body as URLSearchParams;
const decodeBasic = (header: string): string => new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));

describe("clientCredentials requests", () => {
  test("posts the grant through the given fetch with the given signal", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    const controller = new AbortController();
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch, controller.signal));

    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.input).toBe(TOKEN_URL);
    expect(call.init.method).toBe("POST");
    expect(call.init.signal).toBe(controller.signal);
    expect((call.init.headers as Record<string, string>).accept).toBe("application/json");
    expect(bodyOf(call).get("grant_type")).toBe("client_credentials");
  });

  test("sends basic authentication by default and keeps the credentials out of the body", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));

    const call = calls[0] as Call;
    expect(decodeBasic(basicHeader(call))).toBe(`id:${clientSecret}`);
    expect(bodyOf(call).has("client_id")).toBe(false);
    expect(bodyOf(call).has("client_secret")).toBe(false);
  });

  test("form-urlencodes a secret holding a colon, a space and non-ASCII text before the base64", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "my id", clientSecret: "a:b é€" }).getToken(requestOf(fetch));

    // biome-ignore lint/security/noSecrets: a percent-encoded literal, flagged only for its entropy
    expect(decodeBasic(basicHeader(calls[0] as Call))).toBe("my+id:a%3Ab+%C3%A9%E2%82%AC");
  });

  test("sends the credentials in the body with authentication body", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret: "a:b é€", authentication: "body" }).getToken(
      requestOf(fetch),
    );

    const call = calls[0] as Call;
    expect((call.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(bodyOf(call).get("client_id")).toBe("id");
    expect(bodyOf(call).get("client_secret")).toBe("a:b é€");
  });

  test("sends a string scope as it is and joins an array with spaces", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret, scope: "read write" }).getToken(requestOf(fetch));
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret, scope: ["read", "write"] }).getToken(requestOf(fetch));
    await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));

    expect(bodyOf(calls[0] as Call).get("scope")).toBe("read write");
    expect(bodyOf(calls[1] as Call).get("scope")).toBe("read write");
    expect(bodyOf(calls[2] as Call).has("scope")).toBe(false);
  });

  test("sends extra params, and the grant type wins over a same-named param", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    await clientCredentials({
      tokenUrl: new URL(TOKEN_URL),
      clientId: "id",
      clientSecret,
      params: { audience: "https://api.test", grant_type: "password" },
    }).getToken(requestOf(fetch));

    const body = bodyOf(calls[0] as Call);
    expect(body.get("audience")).toBe("https://api.test");
    expect(body.getAll("grant_type")).toEqual(["client_credentials"]);
  });
});

describe("clientCredentials response", () => {
  test("returns the access token with no expiry when expires_in is missing", async () => {
    const { fetch } = scriptedFetch(ok());
    const token = await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));

    expect(token).toEqual({ accessToken });
    expect("expiresAt" in token).toBe(false);
  });

  test.each([
    ["a number", 3600, 3_600_000],
    ["a numeric string", "60", 60_000],
    ["a fraction", 0.5, 500],
  ])("measures expires_in given as %s on the request clock", async (_name, expiresIn, ms) => {
    const { fetch } = scriptedFetch(ok({ expires_in: expiresIn }));
    const token = await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));

    expect(token).toEqual({ accessToken, expiresAt: START + ms });
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["a non-numeric string", "soon"],
    ["a blank string", "  "],
    ["infinite", "Infinity"],
    ["null", null],
    ["a boolean", true],
  ])("rejects an expires_in that is %s", async (_name, expiresIn) => {
    const { fetch } = scriptedFetch(ok({ expires_in: expiresIn }));
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as OAuth2TokenError).message).toContain("invalid expires_in");
    expect((error as Error).cause).toBeUndefined();
    expectNoLeak(error);
  });

  test("accepts any casing of Bearer and an absent token_type", async () => {
    for (const tokenType of ["bearer", "BEARER"]) {
      const { fetch } = scriptedFetch(json({ access_token: accessToken, token_type: tokenType }));
      const token = await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));
      expect(token.accessToken).toBe(accessToken);
    }
    const { fetch } = scriptedFetch(json({ access_token: accessToken }));
    const token = await clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch));
    expect(token.accessToken).toBe(accessToken);
  });

  test.each([
    ["a non-Bearer token_type", () => json({ access_token: accessToken, token_type: "MAC" })],
    ["a non-string token_type", () => json({ access_token: accessToken, token_type: 7 })],
    ["a missing access_token", () => json({ token_type: "Bearer", note: clientSecret })],
    ["a non-string access_token", () => json({ access_token: 42, token_type: "Bearer" })],
    ["an empty access_token", () => json({ access_token: "", token_type: "Bearer" })],
    ["malformed JSON", () => () => new Response(`{"access_token": "${accessToken}`, { status: 200 })],
    ["an empty body", () => () => new Response(null, { status: 204 })],
    ["a JSON null", () => json(null)],
    ["a JSON string", () => json(accessToken)],
  ])("fails with a causeless token error on %s", async (_name, reply) => {
    const { fetch } = scriptedFetch(reply());
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as OAuth2TokenError).tokenUrl).toBe(TOKEN_URL);
    expect((error as Error).cause).toBeUndefined();
    expectNoLeak(error);
  });

  test("fails with the status on a server error and cancels its body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(accessToken));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = scriptedFetch(() => new Response(body, { status: 500 }));
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as OAuth2TokenError).status).toBe(500);
    expect((error as Error).cause).toBeUndefined();
    expect(cancelled).toBe(true);
    expectNoLeak(error);
  });

  test("fails with the status even when cancelling the body rejects", async () => {
    const body = new ReadableStream({
      cancel() {
        throw new Error("cancel refused");
      },
    });
    const { fetch } = scriptedFetch(() => new Response(body, { status: 502 }));
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect((error as OAuth2TokenError).status).toBe(502);
    expect((error as Error).cause).toBeUndefined();
  });

  test("fails with the status on a server error without a body", async () => {
    const { fetch } = scriptedFetch(() => new Response(null, { status: 503 }));
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect((error as OAuth2TokenError).status).toBe(503);
  });

  test.each([400, 401])("reports a %i as a refusal with the OAuth error code only and consumes the body", async (status) => {
    let response: Response | undefined;
    const { fetch } = scriptedFetch(() => {
      response = json({ error: "invalid_client", error_description: `bad secret ${clientSecret}` }, status)();
      return response;
    });
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect(isOAuth2TokenRefusedError(error)).toBe(true);
    expect((error as OAuth2TokenRefusedError).status).toBe(status);
    expect((error as OAuth2TokenRefusedError).error).toBe("invalid_client");
    expect((error as Error).cause).toBeUndefined();
    expect(response?.bodyUsed).toBe(true);
    expectNoLeak(error);
    expect(serialized(error)).not.toContain("bad secret");
  });

  test.each([
    ["a body that is not JSON", () => new Response("<html>nope</html>", { status: 400 })],
    ["a null body", () => new Response(null, { status: 401 })],
    ["a JSON null", json(null, 400)],
    ["a non-string error", json({ error: 7 }, 400)],
    ["an empty object", json({}, 401)],
  ])("reports a refusal without an error code for %s", async (_name, reply) => {
    const { fetch } = scriptedFetch(reply);
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret }).getToken(requestOf(fetch)),
    );

    expect(isOAuth2TokenRefusedError(error)).toBe(true);
    expect((error as OAuth2TokenRefusedError).error).toBeUndefined();
  });

  test("wraps a thrown fetch error as the cause and keeps the secret out of the message", async () => {
    const thrown = new TypeError("network down");
    const fetch: HttpFetch = async () => {
      throw thrown;
    };
    const error = await failureOf(() =>
      clientCredentials({ tokenUrl: "https://auth.test/token?client_secret=hunter2", clientId: "id", clientSecret }).getToken(
        requestOf(fetch),
      ),
    );

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBe(thrown);
    expect((error as Error).message).not.toContain("hunter2");
    expectNoLeak(error);
  });
});

describe("clientCredentials configuration", () => {
  test("rejects userinfo in the token URL without echoing it", () => {
    const error = configErrorOf(() =>
      clientCredentials({ tokenUrl: `https://id:${clientSecret}@auth.test/token`, clientId: "id", clientSecret }),
    );

    expect(isHttpConfigError(error)).toBe(true);
    expectNoLeak(error);
  });

  test("rejects a token URL that is not absolute", () => {
    expect(isHttpConfigError(configErrorOf(() => clientCredentials({ tokenUrl: "/token", clientId: "id", clientSecret })))).toBe(true);
  });

  test("rejects an empty clientId", () => {
    const error = configErrorOf(() => clientCredentials({ tokenUrl: TOKEN_URL, clientId: "", clientSecret }));

    expect(isHttpConfigError(error)).toBe(true);
    expectNoLeak(error);
  });
});

test("the barrel exports clientCredentials", () => {
  expect(barrel.clientCredentials).toBe(clientCredentials);
});
