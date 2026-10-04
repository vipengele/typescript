import type { Detector } from "./key-matcher";

/** A half-open `[start, end)` range of UTF-16 code units in a scanned string. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

interface NormalizedDetector {
  readonly regex: RegExp;
  readonly validate: ((match: string) => boolean) | undefined;
  /** Whether a zero-length match advances by a whole code point rather than a single code unit. */
  readonly unicode: boolean;
}

/**
 * Normalized detectors per detectors array. An array is read once, on its first scan, so mutating
 * it or the detectors in it afterwards has no effect — a caller who needs different detectors
 * passes a new policy.
 */
const normalizedByDetectors = new WeakMap<readonly Detector[], readonly NormalizedDetector[]>();

function normalize({ pattern, validate }: Detector): NormalizedDetector {
  // A private copy, so the caller's own instance and its `lastIndex` are never touched. `g` lets one
  // regex walk every match in a string; `y` is dropped because, alongside `g`, it only matches at the
  // cursor, so a detector would stop at the first character that does not start a match.
  let flags = pattern.flags.replace("y", "");
  if (!flags.includes("g")) flags += "g";
  // `pattern` is a RedactionPolicy detector the application author wrote, never untrusted input —
  // see the README's "trust boundary" caveat.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const regex = new RegExp(pattern.source, flags);
  return { regex, validate, unicode: flags.includes("u") || flags.includes("v") };
}

function normalizedDetectors(detectors: readonly Detector[]): readonly NormalizedDetector[] {
  let normalized = normalizedByDetectors.get(detectors);
  if (normalized === undefined) {
    normalized = detectors.map(normalize);
    normalizedByDetectors.set(detectors, normalized);
  }
  return normalized;
}

/**
 * Pushes every accepted, non-empty match of one detector in `value`. A zero-length match has
 * nothing to replace and leaves `lastIndex` where it is, so the scan steps past it by hand — one
 * code point under `u`/`v`, where stopping inside a surrogate pair would split it, one code unit
 * otherwise.
 */
function scan({ regex, validate, unicode }: NormalizedDetector, value: string, spans: Span[]): void {
  regex.lastIndex = 0;
  let match = regex.exec(value);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) {
      regex.lastIndex = end + (unicode && (value.codePointAt(end) ?? 0) > 0xffff ? 2 : 1);
    } else if (validate === undefined || validate(match[0])) {
      spans.push({ start, end });
    }
    match = regex.exec(value);
  }
}

/**
 * The ranges of `value` any detector matches, merged across detectors into maximal spans sorted by
 * start: overlapping or touching matches (one ending where the next starts) become one span. Each
 * detector's `validate` sees its own raw match before merging, and a rejected match contributes
 * nothing.
 */
export function findDetectorSpans(detectors: readonly Detector[] | undefined, value: string): readonly Span[] {
  if (detectors === undefined || detectors.length === 0 || value === "") return [];
  const spans: Span[] = [];
  const normalized = normalizedDetectors(detectors);
  for (let index = 0; index < normalized.length; index++) {
    scan(normalized[index] as NormalizedDetector, value, spans);
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  let current: Span | undefined;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index] as Span;
    if (current !== undefined && span.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, span.end) };
      merged[merged.length - 1] = current;
    } else {
      current = span;
      merged.push(current);
    }
  }
  return merged;
}

/**
 * `value` with each span replaced by what `replaceSpan` returns for it, given the original text the
 * span covers. `spans` must be sorted and disjoint, as `findDetectorSpans` returns them; the text
 * between spans is kept as is. With no spans, `value` itself is returned.
 */
export function replaceSpans(value: string, spans: readonly Span[], replaceSpan: (match: string, span: Span) => string): string {
  if (spans.length === 0) return value;
  let result = "";
  let cursor = 0;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index] as Span;
    result += value.slice(cursor, span.start) + replaceSpan(value.slice(span.start, span.end), span);
    cursor = span.end;
  }
  return result + value.slice(cursor);
}
