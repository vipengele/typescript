---
about: matchKey() normalizes a RedactionPolicy's matchers once per distinct policy object, cached in a WeakMap keyed by policy identity — mutating policy.keys after the first matchKey() call on that object has no effect
saw:
  - source/core/packages/redaction/src/key-matcher.ts
---

`normalizedMatchers()` (`source/core/packages/redaction/src/key-matcher.ts:36-43`) reads
`policy.keys` exactly once per distinct `RedactionPolicy` object — on the first `matchKey()` call
that sees it — and caches the normalized `(key: string) => boolean` checks in a module-level
`WeakMap<RedactionPolicy, readonly NormalizedMatcher[]>` keyed by the policy object's identity.
A later mutation of that same policy's `keys` array (e.g. `policy.keys.push(newMatcher)`) is
invisible to subsequent `matchKey()` calls with that object; the caller must construct a new
`RedactionPolicy` object to change the effective rules.

This is deliberate (documented in the package's README under "Caveats" and in the doc comment on
`normalizedByPolicy`), not an oversight — normalizing per-key-test would be too slow, and
re-testing a caller-supplied `RegExp` directly would mutate its `lastIndex` when the pattern
carries `g`/`y` flags. `key-matcher.test.ts`'s "a policy's matchers are read once" test proves the
cache behaviorally (mutate after first call, assert the stale form still applies) rather than via
`vi.spyOn`, since same-module ESM calls aren't interceptable that way.

Also: `normalize()` always rebuilds a `RegExp` matcher as a private instance with `g`/`y` flags
stripped (never testing the caller's own `RegExp` instance), so a `g`/`y`-flagged input pattern's
`lastIndex` is never touched and `matchKey()` gives the same answer on every call regardless of
the flags on the matcher the caller passed in.
