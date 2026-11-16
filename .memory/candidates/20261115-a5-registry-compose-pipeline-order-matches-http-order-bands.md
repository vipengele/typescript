---
about: "A5 (#188) pipeline order retry>circuitBreaker>rateLimiter>timeout>bulkhead equals the http Order bands; but the local checkout predates the merge"
saw:
  - source/core/packages/http/src/filter.ts
  - source/core/packages/resilience/src/index.ts
  - docs/adr/0029-http-client-is-a-fetch-filter-chain.md
---
Verified from GitHub main (PR #188 merged 2026-11-15T04:45Z; read via `gh api repos/vipengele/typescript/contents/...?ref=main`), NOT in the local working tree: `ls source/core/packages/resilience/src` has no compose/ or registry/ and index.ts exports only bulkhead/circuit-breaker/errors/rate-limiter/retry/timeout. Pull before building B2.

- `registry.ts` PIPELINE_ORDER = retry, circuitBreaker, rateLimiter, timeout, bulkhead (registry.ts:61), outermost first, whatever order `kinds` lists; this matches http `Order` RETRY 1000 < CIRCUIT_BREAKER 1100 < RATE_LIMITER 1200 < TIMEOUT 1300 < BULKHEAD 1400 (filter.ts:239-248). So http filters at those bands are equivalent to `registry.pipeline`.
- Individual policies by kind+name: `registry.retry(name, override?)`, `.circuitBreaker`, `.rateLimiter`, `.timeout`, `.bulkhead`; one instance per (kind,name), an override on an existing instance throws (registry.ts:26-52,119-131). `pipeline` result carries no `events`; `registry.events` aggregates every created policy's events including those registered before the listener (registry.ts:114-118).
- Breaker state listener: `breaker.events.on(e => ...)` emits `circuit-state-changed {from,to,reason}` and `circuit-call-not-permitted`; `breaker.state`/`.metrics` getters; reset()/forceOpen() (circuit-breaker.ts:47-83). `registry.events` re-emits them.
- `compose(...policies)` (compose.ts:44-55): first outermost; each layer's ctx.signal becomes the next layer's caller signal; inner execute called synchronously so sync admission is preserved; op gets the innermost signal and the attempt of the nearest enclosing policy reporting >1 (nested-retry attempts 2,2,3 accepted). Fresh wrapper named `a > b`, no events.
- ADR numbering: main now holds two ADR-0029 files (docs/adr/0029-resilience-registry-and-composition.md and the local 0029-http-client-is-a-fetch-filter-chain.md); ADR-0012/0014/0015/0023 are also duplicated, so cite ADRs by filename. Next free number for B2-B4 ADRs must be checked on main.
- Defaults (ADR-0029 resilience #3): retry 3 attempts fixed 500ms; breaker 50%/100 window/min 100; limiter 50 per 500ms maxWait 5000; timeout 1000ms; bulkhead 25, no queue.
