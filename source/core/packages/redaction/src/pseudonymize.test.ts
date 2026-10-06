// biome-ignore-all lint/security/noSecrets: every fixture is a made-up key, an RFC 4231 digest or a token derived from them
import { describe, expect, test } from "vitest";
import { redactHeaders } from "./headers";
import type { RedactionPolicy } from "./key-matcher";
import { pseudonymize } from "./pseudonymize";
import { redactQueryString } from "./query-string";
import { redact } from "./redact";
import { applyReplacement, type Replacement } from "./replacement";
import { redactUrl } from "./url";

const KEY = "test-pseudonymize-key";

function token(replacement: Replacement, value: unknown): unknown {
  return applyReplacement(replacement, value, "email");
}

/** RFC 4231 test case 2: HMAC-SHA-256 of "what do ya want for nothing?" under the key "Jefe". */
const RFC4231_CASE_2 = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

/** RFC 4231 test case 1: HMAC-SHA-256 of "Hi There" under twenty 0x0b bytes. */
const RFC4231_CASE_1 = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";

describe("key", () => {
  test.each([
    ["an empty string", ""],
    ["an empty Uint8Array", new Uint8Array(0)],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { secret: KEY }],
    ["an array of bytes", [1, 2, 3]],
    ["an ArrayBuffer", new ArrayBuffer(8)],
  ])("%s makes the factory throw a TypeError", (_, key) => {
    expect(() => pseudonymize({ key: key as unknown as string })).toThrow(TypeError);
  });

  test("missing options make the factory throw a TypeError", () => {
    expect(() => pseudonymize(undefined as unknown as { key: string })).toThrow(TypeError);
  });

  test("the error names the option and what it accepts", () => {
    expect(() => pseudonymize({ key: "" })).toThrow("`key` must be a non-empty string or a non-empty Uint8Array");
  });

  test("a bad prefix or length alongside a good key does not throw", () => {
    expect(() => pseudonymize({ key: KEY, prefix: 7 as unknown as string, length: "x" as unknown as number })).not.toThrow();
  });

  test("a string key and a Uint8Array of its UTF-8 bytes give the same token", () => {
    const fromString = pseudonymize({ key: "clé" });
    const fromBytes = pseudonymize({ key: new TextEncoder().encode("clé") });
    expect(token(fromBytes, "alice")).toBe(token(fromString, "alice"));
  });

  test("a key longer than the 64-byte HMAC block gives the standard HMAC token", () => {
    const message = "Test Using Larger Than Block-Size Key - Hash Key First";
    const digest = "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54";
    const bytes = new Uint8Array(131).fill(0xaa);
    expect(token(pseudonymize({ key: bytes, prefix: "", length: 64 }), message)).toBe(digest);
    expect(token(pseudonymize({ key: "ª".repeat(65), prefix: "", length: 64 }), message)).toBe(
      token(pseudonymize({ key: new TextEncoder().encode("ª".repeat(65)), prefix: "", length: 64 }), message),
    );
  });

  test("a key of exactly 64 bytes and one of 65 bytes both give a stable token", () => {
    for (const size of [64, 65]) {
      const replacement = pseudonymize({ key: new Uint8Array(size).fill(7) });
      expect(token(replacement, "alice")).toBe(token(replacement, "alice"));
    }
  });

  test("a later change to the caller's Uint8Array does not change the tokens", () => {
    const bytes = new TextEncoder().encode(KEY);
    const replacement = pseudonymize({ key: bytes });
    const before = token(replacement, "alice");
    bytes.fill(0);
    expect(token(replacement, "alice")).toBe(before);
    expect(token(replacement, "alice")).toBe(token(pseudonymize({ key: KEY }), "alice"));
  });

  test("different keys give different tokens for the same value", () => {
    expect(token(pseudonymize({ key: "key-one" }), "alice")).not.toBe(token(pseudonymize({ key: "key-two" }), "alice"));
  });
});

describe("token", () => {
  test("is the default prefix and the first 16 hex characters of the HMAC-SHA-256", () => {
    expect(token(pseudonymize({ key: "Jefe" }), "what do ya want for nothing?")).toBe(`pseud_${RFC4231_CASE_2.slice(0, 16)}`);
  });

  test("a Uint8Array key and a length of 64 give the whole digest", () => {
    const replacement = pseudonymize({ key: new Uint8Array(20).fill(0x0b), prefix: "", length: 64 });
    expect(token(replacement, "Hi There")).toBe(RFC4231_CASE_1);
  });

  test("is deterministic across calls and across replacements built from the same key", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, "alice")).toBe(token(replacement, "alice"));
    expect(token(replacement, "alice")).toBe(token(pseudonymize({ key: KEY }), "alice"));
  });

  test("different values give different tokens", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, "alice")).not.toBe(token(replacement, "bob"));
  });

  test("is lowercase hex after the prefix", () => {
    expect(token(pseudonymize({ key: KEY }), "alice")).toMatch(/^pseud_[0-9a-f]{16}$/);
  });

  test("ignores the key it is called with", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(applyReplacement(replacement, "alice", "a")).toBe(applyReplacement(replacement, "alice", "b"));
  });

  test("an empty string has a stable token of its own", () => {
    const replacement = pseudonymize({ key: KEY });
    const empty = token(replacement, "");
    expect(empty).toMatch(/^pseud_[0-9a-f]{16}$/);
    expect(token(replacement, "")).toBe(empty);
    expect(empty).not.toBe(token(replacement, " "));
  });

  test("lone surrogates are encoded as U+FFFD, so two of them share a token", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, "a\uD800")).toBe(token(replacement, "a\uDC00"));
    expect(token(replacement, "a\uD800")).toBe(token(replacement, "a�"));
  });
});

describe("prefix", () => {
  test("replaces the default prefix", () => {
    expect(token(pseudonymize({ key: "Jefe", prefix: "user:" }), "what do ya want for nothing?")).toBe(
      `user:${RFC4231_CASE_2.slice(0, 16)}`,
    );
  });

  test("an empty prefix leaves the bare hex", () => {
    expect(token(pseudonymize({ key: KEY, prefix: "" }), "alice")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a non-string prefix takes the default", () => {
    expect(token(pseudonymize({ key: KEY, prefix: 7 as unknown as string }), "alice")).toMatch(/^pseud_[0-9a-f]{16}$/);
    expect(token(pseudonymize({ key: KEY, prefix: undefined }), "alice")).toMatch(/^pseud_[0-9a-f]{16}$/);
  });
});

describe("length", () => {
  function hexLength(length: unknown): number {
    const out = token(pseudonymize({ key: KEY, prefix: "", length: length as number }), "alice") as string;
    expect(out).toMatch(/^[0-9a-f]+$/);
    return out.length;
  }

  test("keeps that many hex characters", () => {
    expect(token(pseudonymize({ key: "Jefe", length: 8 }), "what do ya want for nothing?")).toBe(`pseud_${RFC4231_CASE_2.slice(0, 8)}`);
    expect(hexLength(1)).toBe(1);
    expect(hexLength(32)).toBe(32);
  });

  test.each([
    ["0", 0, 1],
    ["-0", -0, 1],
    ["a negative", -5, 1],
    ["-Infinity", Number.NEGATIVE_INFINITY, 1],
    ["a fraction below 1", 0.5, 1],
    ["1.5", 1.5, 1],
    ["a fraction", 12.9, 12],
    ["100", 100, 64],
    ["Infinity", Number.POSITIVE_INFINITY, 64],
    ["NaN", Number.NaN, 16],
    ["a numeric string", "8", 16],
    ["undefined", undefined, 16],
  ])("%s keeps %#'s clamped count of hex characters", (_, length, expected) => {
    expect(hexLength(length)).toBe(expected);
  });

  test("a shorter token is a prefix of a longer one under the same key", () => {
    const short = token(pseudonymize({ key: KEY, length: 4 }), "alice") as string;
    const long = token(pseudonymize({ key: KEY, length: 64 }), "alice") as string;
    expect(long.startsWith(short)).toBe(true);
  });
});

describe("non-string values", () => {
  test("a number shares its string form's token", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, 4242)).toBe(token(replacement, "4242"));
  });

  test("a bigint, a boolean and a symbol go through String()", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, 12345678n)).toBe(token(replacement, "12345678"));
    expect(token(replacement, true)).toBe(token(replacement, "true"));
    expect(token(replacement, Symbol("secret"))).toBe(token(replacement, "Symbol(secret)"));
  });

  test("null and undefined go through String(), like every other primitive", () => {
    const replacement = pseudonymize({ key: KEY });
    expect(token(replacement, null)).toBe(token(replacement, "null"));
    expect(token(replacement, undefined)).toBe(token(replacement, "undefined"));
  });

  test.each([
    ["an object", { email: "alice@example.com" }],
    ["an array", ["alice@example.com"]],
    ["a function", () => "alice@example.com"],
    ["a boxed string", new String("alice@example.com")],
    ["a Date", new Date(0)],
  ])("%s is replaced by [REDACTED]", (_, value) => {
    expect(token(pseudonymize({ key: KEY }), value)).toBe("[REDACTED]");
  });
});

describe("as a replacement", () => {
  const policy: RedactionPolicy = { keys: ["email"] };
  const replacement = pseudonymize({ key: KEY });
  const alice = token(replacement, "alice@example.com") as string;

  test("pseudonymizes a key-matched value inside redact, a number included, and an object under the key", () => {
    expect(redact({ email: "alice@example.com", other: "alice@example.com" }, policy, { replacement })).toEqual({
      email: alice,
      other: "alice@example.com",
    });
    expect(redact({ email: 4242 }, policy, { replacement })).toEqual({ email: token(replacement, "4242") });
    expect(redact({ email: { address: "alice@example.com" } }, policy, { replacement })).toEqual({ email: "[REDACTED]" });
  });

  test("the same value under two records gets the same token, so they still correlate", () => {
    const first = redact({ email: "alice@example.com" }, policy, { replacement }) as { email: string };
    const second = redact({ user: { email: "alice@example.com" } }, policy, { replacement }) as { user: { email: string } };
    expect(second.user.email).toBe(first.email);
  });

  test("pseudonymizes a query parameter inside redactUrl and redactQueryString", () => {
    const user = token(replacement, "alice") as string;
    expect(redactUrl("https://example.com/profile?email=alice&id=1", { policy, replacement })).toBe(
      `https://example.com/profile?email=${user}&id=1`,
    );
    expect(redactQueryString("email=alice", { policy, replacement })).toBe(`email=${user}`);
  });

  test("pseudonymizes a header value inside redactHeaders, and Headers accepts the result", () => {
    const bearer = token(replacement, "Bearer abcdef123456") as string;
    const out = redactHeaders(new Headers([["Authorization", "Bearer abcdef123456"]]), { replacement });
    expect(out.get("authorization")).toBe(bearer);
    expect(redactHeaders({ Authorization: "Bearer abcdef123456" }, { replacement })).toEqual({ Authorization: bearer });
    expect(redactHeaders([["Authorization", "Bearer abcdef123456"]], { replacement })).toEqual([["Authorization", bearer]]);
  });
});
