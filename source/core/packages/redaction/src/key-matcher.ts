/**
 * One rule naming the keys whose values are redacted. A bare string matches a key exactly and
 * case-sensitively; a bare `RegExp` is tested against the key with its own flags. The object form
 * adds `caseInsensitive`, which applies the `i` flag to either kind of pattern.
 */
export type KeyMatcher = string | RegExp | { pattern: string | RegExp; caseInsensitive?: boolean };

/** The keys a redaction pass treats as sensitive. */
export interface RedactionPolicy {
  keys: readonly KeyMatcher[];
}

type NormalizedMatcher = (key: string) => boolean;

/**
 * Normalized matchers per policy object. A policy is read once, on its first match, so mutating
 * `keys` afterwards has no effect — a caller who needs different rules passes a new policy.
 */
const normalizedByPolicy = new WeakMap<RedactionPolicy, readonly NormalizedMatcher[]>();

function normalize(matcher: KeyMatcher): NormalizedMatcher {
  const { pattern, caseInsensitive } = typeof matcher === "string" || matcher instanceof RegExp ? { pattern: matcher } : matcher;
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

function normalizedMatchers(policy: RedactionPolicy): readonly NormalizedMatcher[] {
  let matchers = normalizedByPolicy.get(policy);
  if (matchers === undefined) {
    matchers = policy.keys.map(normalize);
    normalizedByPolicy.set(policy, matchers);
  }
  return matchers;
}

/** Whether `key` is matched by any of the policy's key matchers. */
export function matchKey(policy: RedactionPolicy, key: string): boolean {
  return normalizedMatchers(policy).some((matches) => matches(key));
}
