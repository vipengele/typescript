---
about: "Retry-After is parsed strictly because V8's Date.parse reads values like 1.5 or -3 as dates, and timeoutFilter restores the caller signal after next settles so a filter that reruns next on the same context never inherits a fired timer"
saw:
  - source/core/packages/http/src/resilience/predicates.ts
  - source/core/packages/http/src/resilience/timeout-filter.ts
  - source/core/packages/http/src/resilience/retry-filter.ts
---
- `requestedDelay` in predicates.ts accepts delta-seconds only as `^\d+$`, and hands a value to `Date.parse` only when it contains a letter (every HTTP-date names a weekday or month). Without that guard V8's lenient `Date.parse` turns "1.5" or "-3" into a date and a garbage header becomes a wait. An unparsable value gives `undefined`, so the retry falls back to its backoff. The cap check is inclusive: a delay equal to `maxRetryAfterMs` is still retried; above it `shouldRetry` returns false and the caller gets that Response.
- `timeoutFilter` sets `ctx.request.signal` to the policy's composed signal while `next` runs and puts the caller's signal back in a `finally`. Leaving the composed signal on the context would make any filter further out that calls `next` again on the same context (no retry filter, so no fresh attempt context) pass an already-fired timer as the caller signal.
- `retryFilter` writes `HttpResilienceAttributes.attempts` in a `finally`, so it is set on success and failure; it is 0 when the caller's signal was aborted before the first attempt.
