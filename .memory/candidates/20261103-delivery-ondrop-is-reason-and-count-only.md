---
about: "the delivery core's public onDrop is (reason, count) only; entries reach a host only through the internal undelivered hook, which replaces onDrop for retries-exhausted, closed and unload-budget"
saw:
  - source/core/packages/observability/src/delivery/delivery.ts
  - docs/adr/0024-offline-queue-persists-encoded-bodies.md
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
---
`DeliveryOptions.onDrop?: (reason, count) => void` reports counts only (`#drop` in delivery.ts). Entries are handed out
only through the internal `DeliveryOptions.undelivered(entries, reason: UndeliveredReason)` (delivery.ts, `#lose`), which
replaces `onDrop` for `retries-exhausted` (`#settle`, once per batch), `closed` (`#abandon`: the spliced buffer, then the
in-flight batch — two calls) and `unload-budget` (`#unloadDrain`, `entries.slice(prefix.count)`); `queue-full` and
`rejected` always go to `onDrop`. Neither wrapper's public option type carries `undelivered` or `isOffline`
(otlp-sink.ts and otlp-transport.ts declare standalone interfaces). There is still no re-enqueue API: `enqueue` stamps a
fresh `observedMs`, which is why the offline queue replays encoded bodies outside the core (ADR-0024).
