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
});
