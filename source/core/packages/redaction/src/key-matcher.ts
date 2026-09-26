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
  // A private copy without `g`/`y`: those flags make `test` advance `lastIndex`, which would both
  // alternate the result across calls and mutate the caller's own instance.
  const flags = new Set(pattern.flags.replace(/[gy]/g, ""));
  if (caseInsensitive) flags.add("i");
  const regex = new RegExp(pattern.source, [...flags].join(""));
  return (key) => regex.test(key);
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
