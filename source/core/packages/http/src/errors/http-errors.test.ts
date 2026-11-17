import { VipengeleError } from "@vipengele/ts-core-common";
import { serializeError } from "@vipengele/ts-core-common/serialization";
import { describe, expect, test } from "vitest";
import * as errors from "./index";
import {
  HTTP_CONFIG_ERROR_CODE,
  HTTP_STATUS_ERROR_CODE,
  OAUTH2_TOKEN_ERROR_CODE,
  OAUTH2_TOKEN_REFUSED_ERROR_CODE,
  OAuth2TokenError,
  OAuth2TokenRefusedError,
  isOAuth2TokenError,
  isOAuth2TokenRefusedError,
  HttpConfigError,
  HttpError,
  HttpStatusError,
  isHttpConfigError,
  isHttpError,
  isHttpStatusError,
} from "./http-errors";

const password = ["pa", "ss"].join("");
const token = ["abc", "123"].join("");

class OtherError extends VipengeleError {
  readonly code = "other.thing";
}

/** Stands in for a second resolved copy of this package: the right code, an unrelated class identity. */
class ForeignCopy extends Error {
  constructor(readonly code: string) {
    super("foreign");
  }
}

const makeStatus = () =>
  new HttpStatusError({ method: "GET", url: "https://example.com/a", response: new Response(null, { status: 503 }) });

const tokenUrl = `https://user:${password}@auth.example.com/token?client_secret=${token}&page=2`;

const makeRefused = () => new OAuth2TokenRefusedError({ tokenUrl, status: 401, error: "invalid_client" });
const makeToken = () => new OAuth2TokenError({ tokenUrl, reason: "unexpected response shape", status: 500 });

const cases = [
  {
    name: "HttpStatusError",
    code: HTTP_STATUS_ERROR_CODE,
    literal: "http.status",
    make: makeStatus,
    guard: isHttpStatusError,
  },
  {
    name: "HttpConfigError",
    code: HTTP_CONFIG_ERROR_CODE,
    literal: "http.config",
    make: () => new HttpConfigError("bad"),
    guard: isHttpConfigError,
  },
  {
    // biome-ignore lint/security/noSecrets: a class name, flagged only for its entropy
    name: "OAuth2TokenRefusedError",
    code: OAUTH2_TOKEN_REFUSED_ERROR_CODE,
    literal: "http.oauth2-token-refused",
    make: makeRefused,
    guard: isOAuth2TokenRefusedError,
  },
  {
    name: "OAuth2TokenError",
    code: OAUTH2_TOKEN_ERROR_CODE,
    literal: "http.oauth2-token",
    make: makeToken,
    guard: isOAuth2TokenError,
  },
];

describe.each(cases)("$name", ({ code, literal, make, guard }) => {
  test("extends Error, VipengeleError and HttpError", () => {
    const error = make();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VipengeleError);
    expect(error).toBeInstanceOf(HttpError);
  });

  test("carries a namespaced code", () => {
    expect(make().code).toBe(literal);
    expect(code).toBe(literal);
  });

  test("the guard accepts an instance and a plain Error carrying the code", () => {
    expect(guard(make())).toBe(true);
    expect(guard(new ForeignCopy(code))).toBe(true);
  });

  test("the guard rejects another code", () => {
    expect(guard(new OtherError("x"))).toBe(false);
    expect(guard(new ForeignCopy("http.unknown"))).toBe(false);
  });

  test("the guard rejects non-errors, including an object with the code", () => {
    expect(guard({ code })).toBe(false);
    expect(guard("http")).toBe(false);
    expect(guard(null)).toBe(false);
    expect(guard(undefined)).toBe(false);
  });

  test("the other concrete guard rejects it", () => {
    expect(cases.filter((other) => other.guard(make()))).toHaveLength(1);
  });
});

describe("HttpConfigError", () => {
  test("keeps its message and cause", () => {
    const cause = new Error("root");
    const error = new HttpConfigError("bad", { cause });

    expect(error.message).toBe("bad");
    expect(error.cause).toBe(cause);
  });
});

describe("HttpStatusError", () => {
  test("carries the method, url and status, and formats its message", () => {
    const error = makeStatus();

    expect(error.method).toBe("GET");
    expect(error.url).toBe("https://example.com/a");
    expect(error.status).toBe(503);
    expect(error.message).toBe("GET https://example.com/a → 503");
  });

  test("keeps the response, out of enumeration and serialization", () => {
    const response = new Response(null, { status: 404 });
    const error = new HttpStatusError({ method: "POST", url: "https://example.com/", response });

    expect(error.response).toBe(response);
    expect(Object.keys(error)).not.toContain("response");
    expect(Object.keys(error)).toEqual(expect.arrayContaining(["method", "url", "status"]));
    const { data } = serializeError(error);
    expect(data).toBeDefined();
    expect(data).not.toHaveProperty("response");
    expect(data).toMatchObject({ method: "POST", status: 404 });
  });

  test("the response is read-only", () => {
    const error = makeStatus();

    expect(() => {
      (error as { response: Response }).response = new Response();
    }).toThrow(TypeError);
  });

  test("redacts userinfo and secret query parameters in the url and the message", () => {
    const error = new HttpStatusError({
      method: "GET",
      url: `https://user:${password}@example.com/p?access_token=${token}&page=2`,
      response: new Response(null, { status: 401 }),
    });

    for (const text of [error.url, error.message]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(token);
      expect(text).toContain("page=2");
    }
  });

  test("accepts a URL object and redacts it", () => {
    const error = new HttpStatusError({
      method: "GET",
      url: new URL(`https://user:${password}@example.com/p?access_token=${token}`),
      response: new Response(null, { status: 500 }),
    });

    expect(error.url).not.toContain(password);
    expect(error.url).not.toContain(token);
    expect(error.url).toContain("example.com/p");
  });

  test("keeps the cause", () => {
    const cause = new Error("root");
    const error = new HttpStatusError(
      { method: "GET", url: "https://example.com/", response: new Response(null, { status: 500 }) },
      { cause },
    );

    expect(error.cause).toBe(cause);
  });
});

// biome-ignore lint/security/noSecrets: a class name, flagged only for its entropy
describe("OAuth2TokenRefusedError", () => {
  test("carries the status and the OAuth error code", () => {
    const error = makeRefused();

    expect(error.status).toBe(401);
    expect(error.error).toBe("invalid_client");
    expect(error.message).toMatch(/^OAuth2 token request to https:\/\/.*auth\.example\.com\/token\?.* refused → 401$/);
  });

  test("the error code is optional", () => {
    expect(new OAuth2TokenRefusedError({ tokenUrl: "https://auth.example.com/token", status: 400 }).error).toBeUndefined();
  });

  test("redacts the token url in the field and the message", () => {
    const error = makeRefused();

    for (const text of [error.tokenUrl, error.message]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(token);
      expect(text).toContain("page=2");
    }
  });

  test("keeps no response and serializes without secrets", () => {
    const error = makeRefused();

    expect(Object.keys(error)).not.toContain("response");
    const text = JSON.stringify(serializeError(error));
    expect(text).not.toContain(password);
    expect(text).not.toContain(token);
  });
});

describe("OAuth2TokenError", () => {
  test("carries the status when given and none otherwise", () => {
    const error = makeToken();

    expect(error.status).toBe(500);
    expect(error.message).toContain("failed: unexpected response shape → 500");
    const bare = new OAuth2TokenError({ tokenUrl: new URL("https://auth.example.com/token"), reason: "timed out" });
    expect(bare.status).toBeUndefined();
    expect(bare.message).toBe("OAuth2 token request to https://auth.example.com/token failed: timed out");
  });

  test("redacts the token url, given as a string or a URL", () => {
    const fromUrl = new OAuth2TokenError({ tokenUrl: new URL(tokenUrl), reason: "x" });

    for (const text of [makeToken().tokenUrl, makeToken().message, fromUrl.tokenUrl, fromUrl.message]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(token);
    }
  });

  test("keeps a cause only when one is given", () => {
    const cause = new Error("root");

    expect(new OAuth2TokenError({ tokenUrl, reason: "x" }, { cause }).cause).toBe(cause);
    expect(makeToken().cause).toBeUndefined();
    expect("cause" in makeToken()).toBe(false);
  });

  test("serializes without secrets", () => {
    const text = JSON.stringify(serializeError(makeToken()));

    expect(text).not.toContain(password);
    expect(text).not.toContain(token);
  });
});

describe("isHttpError", () => {
  test.each(cases)("accepts a $name", ({ make }) => {
    expect(isHttpError(make())).toBe(true);
  });

  test("accepts a plain Error carrying any http. code", () => {
    expect(isHttpError(new ForeignCopy("http.future-kind"))).toBe(true);
  });

  test("rejects another code and a non-string code", () => {
    expect(isHttpError(new OtherError("x"))).toBe(false);
    expect(isHttpError(new ForeignCopy("httpx"))).toBe(false);
    expect(isHttpError(new Error("no code"))).toBe(false);
    expect(isHttpError(Object.assign(new Error("n"), { code: 7 }))).toBe(false);
  });

  test("rejects non-errors, including an object with an http. code", () => {
    expect(isHttpError({ code: "http.config" })).toBe(false);
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError("http.config")).toBe(false);
  });
});

test("every exported *_CODE starts with http.", () => {
  const codes = Object.entries(errors)
    .filter(([name]) => name.endsWith("_CODE"))
    .map(([, value]) => value);

  expect(codes).toHaveLength(cases.length);
  for (const code of codes) {
    expect(code).toMatch(/^http\./);
  }
});
