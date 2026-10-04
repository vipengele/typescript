import { matchKey } from "./key-matcher";
import { breadthMarker, breadthMarkerKey, exceedsBreadth, keepWithinBreadth, truncateString, uniqueBreadthMarker } from "./limits";
import { type RedactStringOptions, type ResolvedStringOptions, resolveStringOptions } from "./query-string";
import { applyReplacement } from "./replacement";

/** A header list as a record: a name maps to one value, or to several sent under that name. */
export type HeaderRecord = Record<string, string | string[]>;

/** A header list as `[name, value]` pairs, in order, a name appearing as often as it is sent. */
export type HeaderTuples = [string, string][];

/** The replacement key every `Set-Cookie` entry is reported under, whatever casing it was written in. */
const SET_COOKIE = "set-cookie";

/**
 * What a `Headers` result stores in place of a value it rejects. A `Headers` value is a byte
 * string with no CR, LF or NUL, so the `"…[truncated]"` suffix and a replacement outside Latin-1
 * make `append` throw; the value is replaced whole instead, which fails closed.
 */
const HEADERS_FALLBACK = "[REDACTED]";

/**
 * The name a `Headers` result stores its breadth marker under. A header name is an HTTP token, so
 * the `"…"` a record uses is rejected; `.` is a token character.
 */
const HEADERS_BREADTH_NAME = "...";

/**
 * Redacts one header value: replaced whole when the policy matches the name, kept otherwise, then
 * cut to `maxStringLength`. The replacement receives the value and the name as written, or
 * `"set-cookie"` for any casing of `Set-Cookie`.
 */
function redactValue(name: string, value: string, options: ResolvedStringOptions): string {
  if (!matchKey(options.policy, name)) return truncateString(value, options.limits);
  const key = name.toLowerCase() === SET_COOKIE ? SET_COOKIE : name;
  return truncateString(String(applyReplacement(options.replacement, value, key)), options.limits);
}

/**
 * Copies a `Headers` by iterating it, which yields names lower-cased, in sorted order, and every
 * `Set-Cookie` entry on its own — `get("set-cookie")` would join them with `", "`, which a cookie's
 * own `Expires` attribute makes ambiguous. Each entry counts once toward `maxBreadth`; the rest are
 * summarised by one `"[Truncated: N more]"` value under a `"..."` name made unique against the
 * kept names.
 */
function redactHeadersObject(headers: Headers, options: ResolvedStringOptions): Headers {
  const entries = [...headers];
  const out = new Headers();
  for (const [name, value] of keepWithinBreadth(entries, options.limits)) {
    // Only the append is guarded: a value the Headers rejects falls back to the placeholder, while a
    // throwing replacement propagates as it does for a record or pairs.
    const redacted = redactValue(name, value, options);
    try {
      out.append(name, redacted);
    } catch {
      out.append(name, HEADERS_FALLBACK);
    }
  }
  if (exceedsBreadth(entries.length, options.limits)) {
    const name = uniqueBreadthMarker(HEADERS_BREADTH_NAME, (candidate) => out.has(candidate));
    out.append(name, breadthMarker(entries.length, options.limits));
  }
  return out;
}

/**
 * Copies `[name, value]` pairs, names kept as written. An entry that is not an array is dropped
 * and does not count toward `maxBreadth`; a name or value that is not a string is converted with
 * `String()`. Pairs past `maxBreadth` are summarised by one trailing pair whose name is `"…"`,
 * made unique against the kept names, and whose value is `"[Truncated: N more]"`.
 */
function redactTuples(tuples: readonly unknown[], options: ResolvedStringOptions): HeaderTuples {
  const pairs = tuples.filter((entry): entry is readonly unknown[] => Array.isArray(entry));
  const out: HeaderTuples = [];
  for (const [rawName, rawValue] of keepWithinBreadth(pairs, options.limits)) {
    const name = String(rawName);
    out.push([name, redactValue(name, String(rawValue), options)]);
  }
  if (exceedsBreadth(pairs.length, options.limits)) {
    const used = new Set(out.map(([name]) => name));
    out.push([breadthMarkerKey(used), breadthMarker(pairs.length, options.limits)]);
  }
  return out;
}

/**
 * Redacts the values sent under one record name. A list is redacted element by element, bounded
 * like an array in `redact`: its first `maxBreadth` elements, then one `"[Truncated: N more]"`
 * element. A value that is neither a string nor a list is converted with `String()`.
 */
function redactRecordValue(name: string, value: unknown, options: ResolvedStringOptions): string | string[] {
  if (!Array.isArray(value)) return redactValue(name, String(value), options);
  const out = keepWithinBreadth(value as unknown[], options.limits).map((item) => redactValue(name, String(item), options));
  if (exceedsBreadth(value.length, options.limits)) out.push(breadthMarker(value.length, options.limits));
  return out;
}

/**
 * Copies a record's own enumerable names, as written, so names differing only in case stay
 * separate entries. Each name counts once toward `maxBreadth`, however many values it holds; the
 * rest are summarised under a `"…"` key made unique against the kept names, as `redact` does for
 * an object. Fields are defined rather than assigned, so a `"__proto__"` name is copied as data.
 */
function redactRecord(record: object, options: ResolvedStringOptions): HeaderRecord {
  const names = Object.keys(record);
  const out: HeaderRecord = {};
  const define = (name: string, value: string | string[]): void => {
    Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
  };
  for (const name of keepWithinBreadth(names, options.limits)) {
    define(name, redactRecordValue(name, (record as Record<string, unknown>)[name], options));
  }
  if (exceedsBreadth(names.length, options.limits)) {
    define(breadthMarkerKey(new Set(Object.keys(out))), breadthMarker(names.length, options.limits));
  }
  return out;
}

/** Whether the realm has a `Headers` class and `value` is one of its instances. */
function isHeaders(value: unknown): value is Headers {
  return typeof Headers === "function" && value instanceof Headers;
}

/**
 * Returns a copy of `headers` with the whole value of every header whose name the policy matches
 * replaced — no scheme is kept and no cookie is parsed — in the kind it was given: a new `Headers`
 * for a `Headers`, a new record for a record, new pairs for pairs. The input is never mutated and
 * the function never throws on its contents.
 *
 * The policy defaults to {@link secretKeys}, which matches `Authorization`, `Cookie`, `Set-Cookie`
 * and `X-Api-Key`. A `Headers` is read by iteration, so its names arrive, are matched and are
 * reported to a function replacement lower-cased; record and pair names keep their casing. Every
 * `Set-Cookie` entry, and every element of a record list, is replaced on its own, and a function
 * replacement receives `"set-cookie"` as the key of a cookie entry.
 *
 * `maxBreadth` bounds the number of headers kept (`Headers` entries, record names, pairs), and
 * `maxStringLength` cuts every value of the result after redaction. A value a `Headers` rejects —
 * any truncated value, since the `"…[truncated]"` suffix is not a byte string, or a replacement
 * outside Latin-1 — is stored as `"[REDACTED]"`. Input that is none of the three kinds returns an
 * empty record.
 */
export function redactHeaders(headers: Headers, options?: RedactStringOptions): Headers;
export function redactHeaders(headers: HeaderTuples, options?: RedactStringOptions): HeaderTuples;
export function redactHeaders(headers: HeaderRecord, options?: RedactStringOptions): HeaderRecord;
export function redactHeaders(
  headers: Headers | HeaderTuples | HeaderRecord,
  options?: RedactStringOptions,
): Headers | HeaderTuples | HeaderRecord {
  const resolved = resolveStringOptions(options);
  if (isHeaders(headers)) return redactHeadersObject(headers, resolved);
  if (Array.isArray(headers)) return redactTuples(headers, resolved);
  if (typeof headers === "object" && headers !== null) return redactRecord(headers, resolved);
  return {};
}
