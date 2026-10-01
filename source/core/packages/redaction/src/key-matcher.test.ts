import { describe, expect, test } from "vitest";
import { type KeyMatcher, matchKey, type RedactionPolicy } from "./key-matcher";

describe("string matchers", () => {
  test("a bare string matches the exact key, case-sensitively", () => {
    const policy: RedactionPolicy = { keys: ["password"] };
    expect(matchKey(policy, "password")).toBe(true);
    expect(matchKey(policy, "Password")).toBe(false);
    expect(matchKey(policy, "password2")).toBe(false);
  });

  test("an object-form string without caseInsensitive stays case-sensitive", () => {
    const policy: RedactionPolicy = { keys: [{ pattern: "token", caseInsensitive: false }] };
    expect(matchKey(policy, "token")).toBe(true);
    expect(matchKey(policy, "TOKEN")).toBe(false);
  });

  test("an object-form string with caseInsensitive matches the key in any case", () => {
    const policy: RedactionPolicy = { keys: [{ pattern: "apiKey", caseInsensitive: true }] };
    expect(matchKey(policy, "APIKEY")).toBe(true);
    expect(matchKey(policy, "apikey")).toBe(true);
    expect(matchKey(policy, "apiKeys")).toBe(false);
  });
});

describe("RegExp matchers", () => {
  test("a bare RegExp is tested against the key", () => {
    const policy: RedactionPolicy = { keys: [/secret/] };
    expect(matchKey(policy, "clientSecret")).toBe(false);
    expect(matchKey(policy, "client_secret_id")).toBe(true);
  });

  test("an object-form RegExp without caseInsensitive keeps its own flags", () => {
    const policy: RedactionPolicy = { keys: [{ pattern: /^auth/ }] };
    expect(matchKey(policy, "authorization")).toBe(true);
    expect(matchKey(policy, "Authorization")).toBe(false);
  });

  test("an object-form RegExp with caseInsensitive matches the key in any case", () => {
    const policy: RedactionPolicy = { keys: [{ pattern: /secret/, caseInsensitive: true }] };
    expect(matchKey(policy, "clientSecret")).toBe(true);
    expect(matchKey(policy, "CLIENT_SECRET")).toBe(true);
  });

  test("caseInsensitive on a RegExp already carrying the i flag is accepted", () => {
    const policy: RedactionPolicy = { keys: [{ pattern: /cookie/i, caseInsensitive: true }] };
    expect(matchKey(policy, "Set-Cookie")).toBe(true);
  });

  test.for([/token/g, /token/y, /token/gy])("a %s matcher gives the same answer on every call and leaves lastIndex alone", (regex) => {
    const policy: RedactionPolicy = { keys: [regex] };
    const key = regex.sticky ? "token_value" : "access_token";
    expect(matchKey(policy, key)).toBe(true);
    expect(matchKey(policy, key)).toBe(true);
    expect(matchKey(policy, key)).toBe(true);
    expect(regex.lastIndex).toBe(0);
  });

  test("a sticky matcher keeps its anchored-at-start semantics, not just its statelessness", () => {
    const policy: RedactionPolicy = { keys: [/token/y] };

    expect(matchKey(policy, "access_token")).toBe(false);
    expect(matchKey(policy, "access_token")).toBe(false);
    expect(matchKey(policy, "token_id")).toBe(true);
    expect(matchKey(policy, "token_id")).toBe(true);
  });
});

describe("segments matchers", () => {
  test.for([
    { key: "APIKey", spec: "api key" },
    { key: "OAuthToken", spec: "token" },
    { key: "OAuthToken", spec: "o auth" },
    { key: "oauth2Token", spec: "token" },
    { key: "oauth2Token", spec: "oauth 2 token" },
    { key: "x-api-key", spec: "api key" },
    { key: "csrfToken", spec: "token" },
    { key: "session2", spec: "session" },
    { key: "api_secret_key", spec: "secret" },
    { key: "apiKeyId", spec: "API-Key" },
    { key: "HTTPSProxyURL", spec: "proxy url" },
  ])("$key matches { segments: $spec }", ({ key, spec }) => {
    expect(matchKey({ keys: [{ segments: spec }] }, key)).toBe(true);
  });

  test.for([
    { key: "OAuthToken", spec: "oauth" },
    { key: "tokenizer", spec: "token" },
    { key: "api_secret_key", spec: "api key" },
    { key: "apikey", spec: "api key" },
    { key: "session2", spec: "session 3" },
    { key: "key", spec: "api key" },
  ])("$key does not match { segments: $spec }", ({ key, spec }) => {
    expect(matchKey({ keys: [{ segments: spec }] }, key)).toBe(false);
  });

  test("a digit run is its own segment on either side of the letters around it", () => {
    expect(matchKey({ keys: [{ segments: "2" }] }, "oauth2Token")).toBe(true);
    expect(matchKey({ keys: [{ segments: "fa" }] }, "2fa")).toBe(true);
    expect(matchKey({ keys: [{ segments: "12" }] }, "pin12")).toBe(true);
    expect(matchKey({ keys: [{ segments: "1" }] }, "pin12")).toBe(false);
  });

  test("leading, trailing and repeated separators produce no empty segments", () => {
    expect(matchKey({ keys: [{ segments: "  api -- key  " }] }, "__api__key__")).toBe(true);
  });

  test.for(["", "   ", "\t\n", "-_."])("a spec with no letters or digits (%j) matches no key and does not throw", (spec) => {
    const policy: RedactionPolicy = { keys: [{ segments: spec }] };
    expect(matchKey(policy, "")).toBe(false);
    expect(matchKey(policy, "password")).toBe(false);
    expect(matchKey(policy, spec)).toBe(false);
  });

  test("Unicode letters and digits are segment characters, and case changes split them", () => {
    expect(matchKey({ keys: [{ segments: "contraseña" }] }, "userContraseña")).toBe(true);
    expect(matchKey({ keys: [{ segments: "ключ" }] }, "apiКлюч")).toBe(true);
    expect(matchKey({ keys: [{ segments: "ÉTÉ" }] }, "été-key")).toBe(true);
    expect(matchKey({ keys: [{ segments: "٣" }] }, "pin٣")).toBe(true);
  });

  test("a letter without case continues the segment it follows and never splits one", () => {
    expect(matchKey({ keys: [{ segments: "密码" }] }, "user_密码")).toBe(true);
    expect(matchKey({ keys: [{ segments: "a密码" }] }, "A密码")).toBe(true);
    expect(matchKey({ keys: [{ segments: "密码" }] }, "A密码")).toBe(false);
  });

  test("a spec mixing segments with other matcher kinds in one policy", () => {
    const policy: RedactionPolicy = { keys: [{ segments: "secret" }, "password"] };
    expect(matchKey(policy, "clientSecret")).toBe(true);
    expect(matchKey(policy, "password")).toBe(true);
    expect(matchKey(policy, "secretary")).toBe(false);
  });

  test("caseInsensitive and pattern are rejected alongside segments", () => {
    // @ts-expect-error -- segments are always matched case-insensitively.
    const withCase: KeyMatcher = { segments: "token", caseInsensitive: true };
    // @ts-expect-error -- a matcher is either a pattern or segments, never both.
    const withPattern: KeyMatcher = { segments: "token", pattern: "token" };
    expect(withCase).toBeDefined();
    expect(withPattern).toBeDefined();
  });
});

describe("except", () => {
  test("a key matched by keys and by except is not matched", () => {
    const policy: RedactionPolicy = { keys: [{ segments: "token" }], except: ["tokenCount", /^public/] };
    expect(matchKey(policy, "accessToken")).toBe(true);
    expect(matchKey(policy, "tokenCount")).toBe(false);
    expect(matchKey(policy, "publicToken")).toBe(false);
  });

  test("except never adds a match keys did not make", () => {
    const policy: RedactionPolicy = { keys: ["password"], except: ["username"] };
    expect(matchKey(policy, "username")).toBe(false);
    expect(matchKey(policy, "password")).toBe(true);
  });

  test("except accepts every matcher form, segments included", () => {
    const policy: RedactionPolicy = {
      keys: [/./],
      except: [{ segments: "id" }, { pattern: "NAME", caseInsensitive: true }],
    };
    expect(matchKey(policy, "userId")).toBe(false);
    expect(matchKey(policy, "name")).toBe(false);
    expect(matchKey(policy, "idempotencyKey")).toBe(true);
  });

  test("an empty except list exempts nothing", () => {
    expect(matchKey({ keys: ["password"], except: [] }, "password")).toBe(true);
  });
});

describe("policies", () => {
  test("a key matched by any matcher in the policy matches", () => {
    const policy: RedactionPolicy = { keys: ["password", /token$/] };
    expect(matchKey(policy, "password")).toBe(true);
    expect(matchKey(policy, "refresh_token")).toBe(true);
    expect(matchKey(policy, "username")).toBe(false);
  });

  test("a policy with no matchers matches nothing", () => {
    expect(matchKey({ keys: [] }, "password")).toBe(false);
  });

  test("a policy's matchers are read once, so mutating its keys afterwards has no effect", () => {
    const policy: RedactionPolicy = { keys: ["password"] };
    expect(matchKey(policy, "password")).toBe(true);

    (policy.keys as KeyMatcher[]).push("ssn");
    expect(matchKey(policy, "ssn")).toBe(false);

    const fresh: RedactionPolicy = { keys: [...policy.keys] };
    expect(matchKey(fresh, "ssn")).toBe(true);
  });

  test("a policy's exceptions are read once, so mutating except afterwards has no effect", () => {
    const except: KeyMatcher[] = [];
    const policy: RedactionPolicy = { keys: ["password", "ssn"], except };
    expect(matchKey(policy, "ssn")).toBe(true);

    except.push("ssn");
    expect(matchKey(policy, "ssn")).toBe(true);

    expect(matchKey({ ...policy, except: [...except] }, "ssn")).toBe(false);
  });
});
