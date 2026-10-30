---
about: "ADR-0022 fixes the delivery details ADR-0010 left open (OTLP/HTTP JSON, limits, retry statuses, keepalive unload, no sendBeacon); resilience retry/timeout take injectable Scheduler/Clock/AbortSignal and observability depends on them"
saw:
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
  - source/core/packages/resilience/src/retry/retry.ts
  - source/core/packages/resilience/src/retry/backoff.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/observability/package.json
  - source/core/packages/observability/src/delivery/delivery.ts
  - .lydite/components.yml
---
ADR-0010 specifies the HTTP Transport only in outline; ADR-0022 amends it: wire format OTLP/HTTP JSON
`/v1/logs` for logs and Error Events alike, defaults from the OTel batch processor (2048/512/5 s,
5 attempts, full-jitter 1-30 s, 10 s per attempt, 2 s flush), retry on network error/timeout/429/502/
503/504 with `Retry-After`, one `keepalive` fetch on unload within 64 KiB, no `sendBeacon`, IndexedDB
queue deferred behind `onDrop`. The defaults live in `DEFAULT_DELIVERY_LIMITS` (`delivery.ts`).

resilience: `createRetry(name, {maxAttempts, backoff, shouldRetry?, retryAfter?}, {clock?, scheduler?})`
(`retry.ts`); `retryAfter` overrides backoff; op gets `{attempt, signal}`; `execute(op, {signal})`.
`exponentialBackoff`, `withJitter(strategy, "full"|"equal")` (`backoff.ts`); `createTimeout(name,
{durationMs}, {clock?, scheduler?})` (`timeout.ts`) rejects a duration above 2^31-1 ms with
`ResilienceConfigError`. `Scheduler` is `sleep(ms, signal)`, so `createManualTime` drives both.
observability depends on resilience `workspace:*` (`package.json`); lydite's `core-observability`
lists `core-resilience` in `depends_on` and builds it in `setup` (`.lydite/components.yml`), since
its tests import resilience through `dist/`.
