---
about: "ADR-0010 specifies the HTTP JSON Transport only in outline (no wire format, endpoint, limits, retry codes, timeouts, Node exit); resilience retry/timeout already take injectable Scheduler/Clock/AbortSignal and have no cycle with observability"
saw:
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - source/core/packages/resilience/src/retry/retry.ts
  - source/core/packages/resilience/src/retry/backoff.ts
  - source/core/packages/resilience/src/timeout/timeout.ts
  - source/core/packages/resilience/package.json
  - source/core/packages/observability/package.json
  - .lydite/components.yml
  - source/core/turbo.json
---
Found while scoping a shared delivery core for the OTLP log sink and the reporter's HTTP transport (issue #33).

ADR-0010 lines 35-41 are the whole HTTP spec: pagehide/visibilitychange -> fetch keepalive, sendBeacon where keepalive is unavailable; failed/exhausted batch -> IndexedDB queue replayed at creation and on `online`; queue bounded by count and bytes, keeps oldest, drops newest. Only "64 KiB keepalive" appears (line 54). Nothing on endpoint/headers, batch size, flush interval, retry statuses/Retry-After, Node exit, default flush/close timeouts, queue bounds values, or wire format.
Wire format is implied by ADR-0008 lines 40-52 (OTLP Transport is the framework's own export; Error Events go out as log records with exception.type/message/stacktrace; semconv v1.37 constant lives in the Transport) and ADR-0007 lines 76-90 (OTLP mapping table). So log sink and error transport sharing one OTLP encoder is consistent with the ADRs.
resilience: createRetry(name, {maxAttempts, backoff, shouldRetry?, retryAfter?}, {clock?, scheduler?}) retry.ts:164; retryAfter overrides backoff (Retry-After hook); op gets {attempt, signal}; execute(op,{signal}). exponentialBackoff({initialMs, multiplier=2, maxMs}) backoff.ts:227; withJitter(strategy, "full"|"equal", random=Math.random) backoff.ts:243; createTimeout(name,{durationMs},{clock?,scheduler?}) timeout.ts:111. Scheduler is sleep(ms, signal) (common time/scheduler.ts:5), so createManualTime can drive them.
Cycle: resilience depends only on common (package.json deps); observability on common+redaction. No cycle. Both workspace:* intra-project. Cost: add dep to observability package.json, add core-resilience to its lydite depends_on plus a setup build line (.lydite/components.yml:24-27); turbo orders via ^build (turbo.json) automatically.
IndexedDB: grep over source/ finds no use and no fake-indexeddb; Chromium vitest project exists (vitest.shared.ts:36-43) so real IndexedDB works in *.browser.test.ts; Node project would need a fake or a mocked store seam.
