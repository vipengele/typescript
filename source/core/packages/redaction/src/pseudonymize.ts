import { hmacSha256, toHex } from "./hmac-sha256";
import type { Replacement } from "./replacement";

/** How {@link pseudonymize} keys and shapes the tokens it writes. */
export interface PseudonymizeOptions {
  /**
   * The HMAC key: a non-empty string, encoded as UTF-8, or a non-empty `Uint8Array`, copied when
   * the replacement is built so a later change to the caller's array does not change the tokens.
   * Anything else makes {@link pseudonymize} throw a `TypeError`.
   */
  key: string | Uint8Array;
  /** What every token starts with. Defaults to `"pseud_"`; a non-string value takes the default. */
  prefix?: string;
  /**
   * How many hex characters of the digest follow the prefix. Defaults to 16. A fraction is floored
   * and the result clamped to 1..64; `NaN` or a non-number takes the default. Zero is never used, as
   * every value would share the one empty token.
   */
  length?: number;
}

const DEFAULT_PREFIX = "pseud_";

const DEFAULT_LENGTH = 16;

/** Hex characters in a whole HMAC-SHA-256 digest. */
const MAX_LENGTH = 64;

/** What a value with no string form worth correlating on is replaced with. */
const OPAQUE_REPLACEMENT = "[REDACTED]";

/**
 * The key as bytes, or a `TypeError` when it is not a non-empty string or `Uint8Array`. A
 * `Uint8Array` is copied, so the caller's array stays theirs to reuse or zero.
 */
function resolveKey(key: unknown): Uint8Array {
  if (typeof key === "string" && key !== "") return new TextEncoder().encode(key);
  if (key instanceof Uint8Array && key.length > 0) return Uint8Array.from(key);
  throw new TypeError("pseudonymize: `key` must be a non-empty string or a non-empty Uint8Array");
}

function resolvePrefix(prefix: unknown): string {
  return typeof prefix === "string" ? prefix : DEFAULT_PREFIX;
}

/**
 * The number of hex characters to keep: `length` floored and clamped to 1..64, or 16 when it is
 * not a number or is `NaN` — `Math.floor(NaN)` is `NaN`, and `Math.max`/`Math.min` pass it through.
 */
function resolveLength(length: unknown): number {
  if (typeof length !== "number" || Number.isNaN(length)) return DEFAULT_LENGTH;
  return Math.min(MAX_LENGTH, Math.max(1, Math.floor(length)));
}

/**
 * A {@link Replacement} that turns a value into a stable token, `<prefix><hex>`: the first `length`
 * hex characters of the HMAC-SHA-256 of the value under `key`. The same value under the same key
 * always gives the same token, so redacted records can still be correlated, while a reader without
 * the key cannot recompute it from a guess. `pseudonymize({ key })("alice@example.com")` gives
 * something like `"pseud_3f2a9c0d1e4b5a67"`.
 *
 * The key is checked once, here: one that is not a non-empty string or `Uint8Array` throws a
 * `TypeError` from this call, never from the returned replacement, which does not throw. A bad
 * `prefix` or `length` falls back or clamps and never throws.
 *
 * The returned replacement holds the key in memory for as long as it is reachable, and nothing
 * redacts the key itself — keep it out of anything that is logged or redacted.
 *
 * The value is encoded as UTF-8 with `TextEncoder`, which turns a lone surrogate into U+FFFD, so
 * two strings differing only in which lone surrogate they carry share a token. A string key is
 * encoded the same way.
 *
 * A primitive is converted with `String()` first, so `4242` and `"4242"` share a token, as do
 * `null` and `"null"`; the empty string has a token of its own. An object, array, function or
 * boxed string has no string form worth correlating on and is replaced by `"[REDACTED]"`.
 */
export function pseudonymize(options: PseudonymizeOptions): Replacement {
  const key = resolveKey(options?.key);
  const prefix = resolvePrefix(options.prefix);
  const length = resolveLength(options.length);
  const encoder = new TextEncoder();
  return (value: unknown): string => {
    if ((typeof value === "object" && value !== null) || typeof value === "function") return OPAQUE_REPLACEMENT;
    return prefix + toHex(hmacSha256(key, encoder.encode(String(value)))).slice(0, length);
  };
}
