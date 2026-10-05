import type { Replacement } from "./replacement";

/** How {@link maskKeepLast} writes the masked part of a value. */
export interface MaskOptions {
  /**
   * The character the mask run is made of. Defaults to `"*"`. Only the first code point is used; a
   * non-string or empty value takes the default. A character outside Latin-1 cannot be stored in a
   * `Headers` value, so `redactHeaders` stores `"[REDACTED]"` in its place.
   */
  maskChar?: string;
}

const DEFAULT_MASK_CHAR = "*";

/** How many mask characters stand in for the hidden part, whatever its length, so the run never leaks it. */
const MASK_RUN_LENGTH = 4;

/** What a value with no string form worth keeping a tail of is replaced with. */
const OPAQUE_REPLACEMENT = "[REDACTED]";

function resolveMaskChar(maskChar: unknown): string {
  if (typeof maskChar !== "string" || maskChar === "") return DEFAULT_MASK_CHAR;
  return String.fromCodePoint(maskChar.codePointAt(0) as number);
}

/**
 * The number of trailing code units to keep: `keep` floored, or 0 when it is not a finite number.
 * `NaN` and `Infinity` both become 0, never `NaN` — `Math.floor(NaN)` is `NaN`, and
 * `slice(-NaN)` and `slice(-0)` both return the whole string.
 */
function resolveKeep(keep: unknown): number {
  return typeof keep === "number" && Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 0;
}

/**
 * A {@link Replacement} that hides all but the last `keep` UTF-16 code units of a value behind a
 * fixed run of four mask characters and a space: `maskKeepLast(4)` turns `"4242424242424242"` into
 * `"**** 4242"`. The run is the same length whatever the value's, so the result never reveals how
 * long the value was. A value no longer than `keep` — an empty string included — is replaced by
 * the bare run with no tail, and so is every value when `keep` is 0, negative, `NaN` or `Infinity`;
 * a fractional `keep` is floored. A bad `keep` or `maskChar` never throws.
 *
 * The tail is cut in UTF-16 code units, as `maxStringLength` is, so a cut can fall between the
 * two halves of a surrogate pair and keep a lone low surrogate.
 *
 * A primitive is converted with `String()` first, so `4242` and `"4242"` mask the same, as do
 * `null` and `undefined` (`"null"`, `"undefined"`). An object, array, function or boxed string has
 * no tail worth keeping and is replaced by `"[REDACTED]"`.
 */
export function maskKeepLast(keep: number, options?: MaskOptions): Replacement {
  const count = resolveKeep(keep);
  const run = resolveMaskChar(options?.maskChar).repeat(MASK_RUN_LENGTH);
  return (value: unknown): string => {
    if ((typeof value === "object" && value !== null) || typeof value === "function") return OPAQUE_REPLACEMENT;
    const text = String(value);
    return count === 0 || text.length <= count ? run : `${run} ${text.slice(-count)}`;
  };
}
