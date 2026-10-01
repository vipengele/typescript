import type { KeyMatcher, RedactionPolicy } from "./key-matcher";

const SECRET_SEGMENTS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "api key",
  "private key",
  "access key",
  "session",
  "credential",
  "bearer",
] as const;

/**
 * A ready-made policy for the keys that conventionally hold credentials. Every entry is a
 * `{ segments }` matcher, so `token` also covers `refresh_token` and `csrfToken` but not
 * `tokenizer`, `cookie` also covers `Set-Cookie`, and `api key` covers `x-api-key` and `APIKey`.
 *
 * Bare `auth` and `key` are deliberately absent: `auth` matches `auth.method`, `authMode` and
 * `auth_provider`, which carry no secret, and `key` matches every `primaryKey` and `cacheKey`. A caller who
 * wants either composes it in with {@link composePolicies}.
 *
 * The policy and its `keys` array are frozen, so no caller can widen or narrow it for everyone
 * else.
 */
export const secretKeys: RedactionPolicy = /*#__PURE__*/ Object.freeze({
  keys: /*#__PURE__*/ Object.freeze(SECRET_SEGMENTS.map((segments): KeyMatcher => Object.freeze({ segments }))),
});
