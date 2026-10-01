import { describe, expect, test } from "vitest";
import { matchKey } from "./key-matcher";
import { redact } from "./redact";
import { secretKeys } from "./secret-keys";

describe("secretKeys matching", () => {
  test.each([
    "password",
    "userPassword",
    "passwd",
    "pwd",
    "secret",
    "clientSecret",
    "token",
    "refresh_token",
    "csrfToken",
    "authorization",
    "Authorization",
    "cookie",
    "Set-Cookie",
    "api key",
    "x-api-key",
    "APIKey",
    "private_key",
    "accessKey",
    "session",
    "sessionId",
    "session2",
    "credential",
    "bearer",
  ])("matches %s", (key) => {
    expect(matchKey(secretKeys, key)).toBe(true);
  });

  test.each(["tokenizer", "key", "auth", "monkey", "author", "primaryKey", "credentials", "name"])("does not match %s", (key) => {
    expect(matchKey(secretKeys, key)).toBe(false);
  });

  test("redacts the values under matched keys", () => {
    expect(redact({ user: "ada", password: "x", headers: { "x-api-key": "k", Accept: "json" } }, secretKeys)).toEqual({
      user: "ada",
      password: "[REDACTED]",
      headers: { "x-api-key": "[REDACTED]", Accept: "json" },
    });
  });
});

describe("secretKeys immutability", () => {
  test("the policy and its keys are frozen", () => {
    expect(Object.isFrozen(secretKeys)).toBe(true);
    expect(Object.isFrozen(secretKeys.keys)).toBe(true);
  });

  test("mutating the policy or its keys throws", () => {
    expect(() => {
      (secretKeys.keys as unknown[]).push("auth");
    }).toThrow(TypeError);
    expect(() => {
      (secretKeys as { keys: unknown }).keys = [];
    }).toThrow(TypeError);
  });
});
