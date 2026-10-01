---
about: matchKey() normalizes a RedactionPolicy's keys and except matchers once per distinct policy object, cached in a WeakMap keyed by policy identity — mutating policy.keys or policy.except after the first matchKey() call on that object has no effect
saw:
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/redaction/src/compose-policies.ts
---

`normalizedPolicy()` (`source/core/packages/redaction/src/key-matcher.ts`) reads `policy.keys` and
`policy.except` exactly once per distinct `RedactionPolicy` object — on the first `matchKey()` call
that sees it — and caches the normalized matchers as `{ keys, except }` in a module-level
`WeakMap<RedactionPolicy, NormalizedPolicy>` keyed by the policy object's identity. A later mutation
of either array is invisible to subsequent `matchKey()` calls with that object; the caller must
construct a new `RedactionPolicy` object to change the effective rules.

This is deliberate (documented in the package README under "Caveats" and in the doc comment on
`normalizedByPolicy`), not an oversight — normalizing per-key-test would be too slow, and
re-testing a caller-supplied `RegExp` directly would mutate its `lastIndex` when the pattern
carries `g`/`y` flags. It is also why `composePolicies()` builds a fresh frozen policy rather than
mutating one, and why callers compose once at startup: a new object per call is re-normalized every
time (ADR-0011).

`key-matcher.test.ts`'s "a policy's matchers are read once" test proves the cache behaviorally
(mutate after first call, assert the stale form still applies) rather than via `vi.spyOn`, since
same-module ESM calls aren't interceptable that way.

A `RegExp` matcher is rebuilt as a private instance that keeps the caller's flags (stripping `g`/`y`
would turn a sticky matcher into an unanchored one), and its `lastIndex` is reset before every test,
so the caller's own instance is never touched and `matchKey()` gives the same answer on every call.
