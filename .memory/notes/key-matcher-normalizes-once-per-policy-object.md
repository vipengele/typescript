---
name: key-matcher-normalizes-once-per-policy-object
kind: gotcha
description: matchKey() normalizes a RedactionPolicy once per object identity via a WeakMap, so mutating policy.keys or policy.except afterwards has no effect.
anchors:
  - path: source/core/packages/redaction/src/key-matcher.ts
    blob: d040431262c8
  - path: source/core/packages/redaction/src/compose-policies.ts
    blob: 2270417e55bf
confidence: verified
---

`normalizedPolicy()` (`key-matcher.ts:151`) caches normalized matchers in `normalizedByPolicy`, a
`WeakMap` keyed by the policy object (`key-matcher.ts:50`). Later mutation of `keys`/`except` is
ignored; build a new policy. Deliberate: per-test normalization is too slow, and re-testing a
caller's `g`/`y` RegExp would mutate its `lastIndex` (matchers are rebuilt as private instances
with the caller's flags). It is why `composePolicies()` returns a fresh frozen policy, and why
composing per call re-normalizes every time (ADR-0011).
