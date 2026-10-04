import { matchKey, type RedactionPolicy } from "./key-matcher";
import { breadthMarker, exceedsBreadth, isBreadthFull, type Limits, resolveLimits, truncateString } from "./limits";
import { applyReplacement, type Replacement } from "./replacement";
import { secretKeys } from "./secret-keys";

/**
 * How a string redaction helper chooses what to redact, what it writes in its place, and how much
 * of the result it keeps. `NaN` disables a limit and `Infinity` turns it off on purpose;
 * `maxBreadth` is floored and clamped at 0.
 */
export interface RedactStringOptions {
  /** The parameter names whose values are redacted. Defaults to {@link secretKeys}. */
  policy?: RedactionPolicy;
  /**
   * What a matched value is replaced with. Defaults to the string `"[REDACTED]"`. A function
   * receives the percent-decoded value and name; a non-string return is converted with `String()`
   * and written as-is, without percent-encoding.
   */
  replacement?: Replacement;
  /**
   * UTF-16 code units of the redacted result kept before it is cut and suffixed with
   * `"…[truncated]"`. Defaults to 8192.
   */
  maxStringLength?: number;
  /**
   * Parameters kept; the rest are dropped and summarised by one trailing `"[Truncated: N more]"`
   * segment. Empty segments (`a=1&&b=2`) are not parameters and are not counted. Defaults to 100.
   */
  maxBreadth?: number;
}

/** Every string redaction option with its default filled in. */
export interface ResolvedStringOptions {
  readonly policy: RedactionPolicy;
  readonly replacement: Replacement;
  readonly limits: Limits;
}

const DEFAULT_REPLACEMENT = "[REDACTED]";

/** Fills in each option the caller left out; the limit defaults are `resolveLimits`'s. */
export function resolveStringOptions(options?: RedactStringOptions): ResolvedStringOptions {
  return {
    policy: options?.policy ?? secretKeys,
    replacement: options?.replacement ?? DEFAULT_REPLACEMENT,
    limits: resolveLimits(options),
  };
}

/**
 * Form-decodes one name or value: `+` is a space, then percent escapes are decoded. Returns
 * `undefined` when an escape is malformed or decodes to invalid UTF-8.
 */
function formDecode(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

/** Redacts one non-empty `&`-separated segment, returning it byte-for-byte when nothing matches. */
function redactSegment(segment: string, options: ResolvedStringOptions): string {
  const equals = segment.indexOf("=");
  if (equals === -1) return segment;
  const rawName = segment.slice(0, equals);
  const rawValue = segment.slice(equals + 1);
  const name = formDecode(rawName);
  // An undecodable name cannot be checked against the policy, so its value is redacted unread.
  if (name !== undefined && !matchKey(options.policy, name)) return segment;
  const value = formDecode(rawValue) ?? rawValue;
  return `${rawName}=${String(applyReplacement(options.replacement, value, name ?? rawName))}`;
}

/**
 * Redacts the values of an `&`-separated parameter list, with no leading `?`, matched by name
 * against the policy. The text is never parsed into a `URLSearchParams` and re-serialised, so
 * every byte outside a redacted value — separators, empty segments, escapes, `+` — is kept as
 * written. A segment with no `=` has no value and is kept whole. A name is form-decoded before
 * matching; one that cannot be decoded has its value redacted. The replacement receives the
 * decoded value (the raw value when that cannot be decoded) and the decoded name (the raw name
 * when that cannot be decoded).
 *
 * Parameters past `maxBreadth` are dropped and replaced by one `"[Truncated: N more]"` segment.
 * The result is not truncated to `maxStringLength`; the caller truncates the whole string it
 * builds, after redaction.
 */
export function redactParams(source: string, options: ResolvedStringOptions): string {
  const segments = source.split("&");
  const total = segments.reduce((count, segment) => (segment === "" ? count : count + 1), 0);
  const { limits } = options;
  const kept: string[] = [];
  let parameters = 0;
  let end = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment !== "") {
      if (isBreadthFull(parameters, limits)) break;
      parameters++;
      end = index + 1;
    }
    kept.push(segment === "" ? segment : redactSegment(segment, options));
  }
  if (!exceedsBreadth(total, limits)) return kept.join("&");
  return [...kept.slice(0, end), breadthMarker(total, limits)].join("&");
}

/**
 * Returns `query` with the value of every parameter whose name the policy matches replaced, as
 * {@link redactParams} describes. A leading `?` is kept. The input is read as text, so relative,
 * partial and malformed input is accepted, and the function never throws on its contents. The
 * redacted result is cut to `maxStringLength` last.
 */
export function redactQueryString(query: string, options?: RedactStringOptions): string {
  const resolved = resolveStringOptions(options);
  const prefix = query.startsWith("?") ? "?" : "";
  return truncateString(`${prefix}${redactParams(query.slice(prefix.length), resolved)}`, resolved.limits);
}
