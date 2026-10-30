---
about: "ADR-0010 fixes the HTTP transport's unload, offline-queue and keep-oldest drop policy; ADR-0022 fixes its drop reporting, wire format, capped waits and one-request-in-flight"
saw:
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0022-http-json-transport-delivery.md
  - docs/adr/0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md
  - source/core/packages/observability/src/errors/transports/http-transport.ts
  - source/core/packages/common/src/time/scheduler.ts
---
ADR-0010 (not obvious from CLAUDE.md): pagehide/visibilitychange->hidden drains via fetch keepalive or sendBeacon; a failed/exhausted batch goes to a bounded (entries and bytes) IndexedDB queue replayed at creation and on `online`; once full it keeps what it holds and drops arrivals (not a ring buffer); offline and unload are options of the HTTP transport, not wrappers; the 64 KiB keepalive limit is the Transport's batching concern.
ADR-0022 records the rest for `createHttpTransport` (http-transport.ts): drops go to `onDrop(events, reason)` or warn once per reason; body `{"resource", "events"}`; no `unref` and no exit hooks, so every wait is capped by `maxDelayMs` and each attempt by `requestTimeoutMs`; one request in flight, so a 429/503 wait pauses the whole queue. The exit-time flush stays with global handlers (ADR-0012). `systemScheduler` is a bare setTimeout with no unref (scheduler.ts), which is why the caps exist.
