---
name: retry-after-is-parsed-strictly-before-date-parse
kind: gotcha
description: The http retry predicate accepts Retry-After delta-seconds only as digits and calls Date.parse only on values containing a letter, because V8's Date.parse reads values like 1.5 or -3 as dates.
anchors:
  - path: source/core/packages/http/src/resilience/predicates.ts
    blob: 674bd7235599
confidence: verified
---

`requestedDelay` in `source/core/packages/http/src/resilience/predicates.ts:64-83` accepts
delta-seconds only when the header matches `^\d+$` (`:24,72-74`) and hands a value to
`Date.parse` only when it contains a letter (`:75-78`); every HTTP-date names a weekday or month.
Without that guard V8's lenient `Date.parse` turns `"1.5"` or `"-3"` into a date and a garbage
header becomes a wait.

An unparsable value gives `undefined`, so the retry falls back to its backoff. The cap is
inclusive: a delay equal to `maxRetryAfterMs` is still retried (`:128`); above it the predicate
declines and the caller gets that Response.
