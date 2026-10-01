/**
 * One rule naming the keys whose values are redacted. A bare string matches a key exactly and
 * case-sensitively; a bare `RegExp` is tested against the key with its own flags. The
 * `{ pattern }` form adds `caseInsensitive`, which applies the `i` flag to either kind of pattern.
 *
 * The `{ segments }` form matches by word rather than by character. The key and the spec are each
 * split into lower-cased segments — at every character that is not a letter or a digit, at a
 * lower-to-upper case change, before the last capital of an acronym run (`APIKey` is `api`, `key`;
 * `OAuthToken` is `o`, `auth`, `token`), and around every run of digits (`oauth2Token` is `oauth`,
 * `2`, `token`) — and the key matches when the spec's segments appear contiguously among its own.
 * So `{ segments: "api key" }` matches `APIKey`, `x-api-key` and `apiKeyId`, but not
 * `api_secret_key` or `apikey`; `{ segments: "token" }` matches `csrfToken` but not `tokenizer`.
 * Segmenting is always case-insensitive, so `caseInsensitive` is not accepted alongside it. A
 * spec with no letters or digits — empty, or only whitespace and punctuation — has no segments
 * and matches no key.
 */
export type KeyMatcher =
  | string
  | RegExp
  | { pattern: string | RegExp; caseInsensitive?: boolean; segments?: never }
  | { segments: string; pattern?: never; caseInsensitive?: never };

/**
 * The keys a redaction pass treats as sensitive. A key is redacted when any `keys` matcher
 * matches it and no `except` matcher does, so `except` carves exemptions out of a broad rule —
 * `{ keys: [{ segments: "token" }], except: ["tokenCount"] }`.
 */
export interface RedactionPolicy {
  keys: readonly KeyMatcher[];
  except?: readonly KeyMatcher[];
}

/**
 * Tests one key. `segments` returns the key's word segments; a `{ segments }` matcher is the only
 * kind that calls it, and every matcher in one `matchKey` call shares the same memoized getter, so
 * the key is segmented at most once per call however many `{ segments }` matchers the policy has.
 */
type NormalizedMatcher = (key: string, segments: () => readonly string[]) => boolean;

interface NormalizedPolicy {
  readonly keys: readonly NormalizedMatcher[];
  readonly except: readonly NormalizedMatcher[];
}

/**
 * Normalized matchers per policy object. A policy is read once, on its first match, so mutating
 * `keys` or `except` afterwards has no effect — a caller who needs different rules passes a new
 * policy.
 */
const normalizedByPolicy = new WeakMap<RedactionPolicy, NormalizedPolicy>();

// Each of these tests exactly one character against a fixed class, so its cost is constant per
// character; segmenting never builds or runs a pattern derived from a key or a spec.
const UPPER = /^[\p{Lu}\p{Lt}]$/u;
const LOWER = /^\p{Ll}$/u;
const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{N}$/u;

type CharKind = "upper" | "lower" | "letter" | "digit" | "separator";

function kindOf(char: string): CharKind {
  if (UPPER.test(char)) return "upper";
  if (LOWER.test(char)) return "lower";
  if (LETTER.test(char)) return "letter";
  if (DIGIT.test(char)) return "digit";
  return "separator";
}

/**
 * Splits `text` into lower-cased word segments, walking it one code point at a time. A letter
 * without case (`letter`) never opens a boundary of its own; it only continues the segment it
 * follows.
 */
function segment(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  let previous: CharKind = "separator";
  let previousChar = "";
  const close = (): void => {
    if (current !== "") segments.push(current.toLowerCase());
    current = "";
  };
  for (const char of text) {
    const kind = kindOf(char);
    if (kind === "separator") {
      close();
    } else if (kind === "digit") {
      if (previous !== "digit") close();
      current += char;
    } else {
      if (previous === "digit" || (kind === "upper" && previous === "lower")) {
        close();
      } else if (kind === "lower" && previous === "upper") {
        // The last capital of an acronym run starts the next word: `APIKey` is `API`, `Key`.
        current = current.slice(0, -previousChar.length);
        close();
        current = previousChar;
      }
      current += char;
    }
    previous = kind;
    previousChar = char;
  }
  close();
  return segments;
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  return haystack.some((_, start) => needle.every((part, offset) => haystack[start + offset] === part));
}

function normalizeSegments(spec: string): NormalizedMatcher {
  const wanted = segment(spec);
  if (wanted.length === 0) return () => false;
  return (_key, segments) => containsRun(segments(), wanted);
}

function normalize(matcher: KeyMatcher): NormalizedMatcher {
  if (typeof matcher === "object" && !(matcher instanceof RegExp) && typeof matcher.segments === "string") {
    return normalizeSegments(matcher.segments);
  }
  const { pattern, caseInsensitive } =
    typeof matcher === "string" || matcher instanceof RegExp
      ? { pattern: matcher, caseInsensitive: false }
      : (matcher as { pattern: string | RegExp; caseInsensitive?: boolean });
  if (typeof pattern === "string") {
    if (!caseInsensitive) return (key) => key === pattern;
    const lowered = pattern.toLowerCase();
    return (key) => key.toLowerCase() === lowered;
  }
  // A private copy, so the caller's own instance is never mutated. Its flags are kept as given —
  // stripping `g`/`y` would silently turn a sticky matcher into an unanchored one, matching a
  // substring anywhere instead of only at the start. `g`/`y` still advance this copy's own
  // `lastIndex` on a match, so it is reset before every test: otherwise a sticky matcher would
  // stop matching after its first hit, and a global one would start each test from wherever the
  // last one left off instead of from the start of the key.
  const flags = new Set(pattern.flags);
  if (caseInsensitive) flags.add("i");
  // `pattern` is a RedactionPolicy matcher the application author wrote, never untrusted input —
  // see the README's "trust boundary" caveat. There is no attacker-controlled pattern here to be
  // catastrophic, and no attacker-controlled subject string either: matchKey() only ever tests
  // this against short key names the walker visits.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const regex = new RegExp(pattern.source, [...flags].join(""));
  return (key) => {
    regex.lastIndex = 0;
    return regex.test(key);
  };
}

function normalizedPolicy(policy: RedactionPolicy): NormalizedPolicy {
  let normalized = normalizedByPolicy.get(policy);
  if (normalized === undefined) {
    normalized = { keys: policy.keys.map(normalize), except: (policy.except ?? []).map(normalize) };
    normalizedByPolicy.set(policy, normalized);
  }
  return normalized;
}

/** Whether `key` is matched by any of the policy's key matchers and by none of its exceptions. */
export function matchKey(policy: RedactionPolicy, key: string): boolean {
  const { keys, except } = normalizedPolicy(policy);
  let keySegments: readonly string[] | undefined;
  const segments = (): readonly string[] => {
    keySegments ??= segment(key);
    return keySegments;
  };
  return keys.some((matches) => matches(key, segments)) && !except.some((matches) => matches(key, segments));
}
