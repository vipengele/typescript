---
about: "an outer http filter (AUTH) may call next() twice with ctx.fork(); nothing guards re-entry, a one-shot body cannot be replayed, and the fork carries the first pass's headers"
saw:
  - source/core/packages/http/src/chain.ts
  - source/core/packages/http/src/context.ts
  - source/core/packages/http/src/dispatch.ts
  - source/core/packages/http/src/resilience/retry-filter.ts
  - source/core/packages/http/src/resilience/predicates.ts
  - docs/adr/0029-http-client-is-a-fetch-filter-chain.md
  - docs/adr/0030-http-resilience-filters.md
  - docs/adr/0031-oauth2-filter-single-flight-refresh-and-replay-once.md
  - source/core/packages/http/src/auth/oauth2-filter.ts
---
- `compose` (chain.ts:43-52) hands each filter `(next = ctx) => run(index+1, next)`; no re-entry guard, so
  `next` may be called any number of times with any ctx. ADR-0029 decision 2 says so (calling next more than
  once reruns everything downstream).
- `fork()` (context.ts:74-76) = `createAttemptContext(this, attempt+1)` (context.ts:86-90): new URL and
  Headers copy (a copy of the headers AS MUTATED by the first pass, so an Authorization set before the first
  next() is carried and must be overwritten), SAME body, signal, attributes, fetch.
- One-shot body: no fork-time check. `replayable` (context.ts:70-72) is live `!isOneShotBody(request.body)`.
  The second dispatch throws HttpConfigError from dispatch.ts:61-65 (wasSent, realm-wide WeakSet). A filter
  replaying must test `ctx.replayable` itself and return the 401 Response untouched.
- retry-filter does it that way: predicates.ts:124 `!base.replayable` ends retries; retry builds a fresh
  `createAttemptContext(base, attempt)` per attempt (retry-filter.ts:46), not fork chains (ADR-0030 d4).
  defaultRetryPredicate also never retries HttpConfigError (predicates.ts:86).
- Replay from AUTH (outside retry) re-enters retry/breaker/limiter/timeout/bulkhead as a new call: retry's
  policy.execute restarts at attempt 1 (fresh budget), BUT `HttpResilienceAttributes.attempts` is on the
  shared attributes and retry's `finally` overwrites it (retry-filter.ts:52-54), so the first pass's count is lost.
  The breaker/limiter/bulkhead are shared stateful policies, so the replay counts against them again.
- ADR-0029 d5 (lines 60-63): filters see the 401 as a Response, "an auth filter a 401 without catching
  anything"; dispatch never cancels a body, so a replaying filter cancels the 401 body itself, as
  `src/auth/oauth2-filter.ts` does (`response.body?.cancel().catch(noop)`). ADR-0031 records the 401
  replay-once decision.
