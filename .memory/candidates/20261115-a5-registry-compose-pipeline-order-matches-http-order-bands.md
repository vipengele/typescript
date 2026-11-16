---
about: "the resilience registry pipeline order retry>circuitBreaker>rateLimiter>timeout>bulkhead equals the http Order bands, and http's resilienceFilters relies on it"
saw:
  - source/core/packages/http/src/filter.ts
  - source/core/packages/resilience/src/index.ts
  - docs/adr/0029-http-client-is-a-fetch-filter-chain.md
  - source/core/packages/http/src/resilience/resilience-filters.ts
---
Verified in the checkout. `resilienceFilters` (http/src/resilience/resilience-filters.ts) returns its filters in `registry.kinds()` order and that is band order only because the two orders agree; changing either order breaks the equivalence silently.

- `registry.ts` PIPELINE_ORDER = retry, circuitBreaker, rateLimiter, timeout, bulkhead (registry.ts:61), outermost first, whatever order `kinds` lists; this matches http `Order` RETRY 1000 < CIRCUIT_BREAKER 1100 < RATE_LIMITER 1200 < TIMEOUT 1300 < BULKHEAD 1400 (filter.ts:239-248). So http filters at those bands are equivalent to `registry.pipeline`.
- Individual policies by kind+name: `registry.retry(name, override?)`, `.circuitBreaker`, `.rateLimiter`, `.timeout`, `.bulkhead`; one instance per (kind,name), an override on an existing instance throws (registry.ts:26-52,119-131). `pipeline` result carries no `events`; `registry.events` aggregates every created policy's events including those registered before the listener (registry.ts:114-118).
- Breaker state listener: `breaker.events.on(e => ...)` emits `circuit-state-changed {from,to,reason}` and `circuit-call-not-permitted`; `breaker.state`/`.metrics` getters; reset()/forceOpen() (circuit-breaker.ts:47-83). `registry.events` re-emits them.
- `compose(...policies)` (compose.ts:44-55): first outermost; each layer's ctx.signal becomes the next layer's caller signal; inner execute called synchronously so sync admission is preserved; op gets the innermost signal and the attempt of the nearest enclosing policy reporting >1 (nested-retry attempts 2,2,3 accepted). Fresh wrapper named `a > b`, no events.
- ADR numbering: docs/adr holds two ADR-0029 files (0029-resilience-registry-and-composition.md and 0029-http-client-is-a-fetch-filter-chain.md); ADR-0012/0014/0015/0023 are also duplicated, so cite ADRs by filename. The http resilience filters are 0030-http-resilience-filters.md; check `ls docs/adr` for the next free number.
- Defaults (ADR-0029 resilience #3): retry 3 attempts fixed 500ms; breaker 50%/100 window/min 100; limiter 50 per 500ms maxWait 5000; timeout 1000ms; bulkhead 25, no queue.
