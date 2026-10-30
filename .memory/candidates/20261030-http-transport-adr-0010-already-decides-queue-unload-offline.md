---
about: "ADR-0010 already fixes the HTTP transport's unload, offline-queue and keep-oldest drop policy; flush/close timeouts, drop reporting, wire format and timer unref are undecided"
saw:
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/observability/src/errors/transport.ts
  - source/core/packages/common/src/time/scheduler.ts
---
Read while planning issue #45 (HTTP JSON Transport). Decided in ADR-0010 (not obvious from CLAUDE.md): pagehide/visibilitychange->hidden drains via fetch keepalive or sendBeacon; failed/exhausted batch goes to a bounded (entries and bytes) IndexedDB queue replayed at creation and on `online`; once full it keeps what it holds and drops arrivals (NOT a ring buffer); offline/unload are options of the HTTP transport, not wrappers; 64 KiB keepalive limit is the Transport's batching concern.
Undecided (grep for onDrop/unref/Retry-After/429/beacon/keepalive in docs and src finds nothing beyond ADR-0010): drop reporting channel, default flush/close timeout (only global handlers' 2000ms flushTimeoutMs, ADR-0012), wire format, Retry-After, timer unref, exit-hook registration (global handlers owns exit flush, ADR-0012).
Scheduler is only `sleep(ms, signal?)` (scheduler.ts:5-12); systemScheduler uses bare setTimeout with no unref (scheduler.ts:20-38). Resilience package (createRetry, exponentialBackoff, withJitter, takes a Scheduler; release v0.2.1) exists; its retry has a `retryAfter(outcome, attempt)` hook for a server-named delay (retry.ts:25-28,112). It is not currently a dependency of observability (package.json has no resilience entry).
