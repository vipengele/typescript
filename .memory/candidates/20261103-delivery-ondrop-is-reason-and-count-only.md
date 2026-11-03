---
about: "the delivery core's onDrop is (reason, count) only, so ADR-0022's 'a queue attaches through onDrop' cannot hold; no startup re-enqueue, no offline notion either"
saw:
  - source/core/packages/observability/src/delivery/delivery.ts
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - source/core/packages/observability/src/errors/transports/http-transport.ts
---
`DeliveryOptions.onDrop?: (reason, count) => void` (delivery.ts:84); `#drop` (:263-270) calls it with counts only.
ADR-0022 (otlp-export) says "A queue added later attaches through `onDrop`, which reports every dropped item, without a
change to the core's contract" (lines 91-92): false as built. Entries (`DeliveryEntry{item,resource,observedMs}`, :21-26)
are never handed out. Fire sites: queue-full `enqueue` :238-241 (item and resource in hand, not retained); rejected and
retries-exhausted `#settle` :273-281 via `#exportBatch` :321/329/331 (`batch.entries` and the encoded `request.body`
are in scope but only `.length` is passed); closed `#abandon` :403-412 (buffer spliced, batch entries in hand);
unload-budget / unload rejected `#unloadDrain` :473-494 (`entries`, `prefix` in scope). So every site could pass
entries cheaply, but the contract must change (a real core change, contrary to ADR-0022's claim). Also absent: a
re-enqueue API (only `enqueue(item,resource)`, which stamps a fresh `observedMs` :242), any online/offline signal
(retry treats network errors as retryable, `retryable` :141-147), and unload keepalive outcome is unobserved (:500).
ADR-0010 lines 39-45: offline queue is an option of the HTTP JSON Transport, not a wrapper; bounded by count and bytes,
keep-oldest; replayed at creation and on `online`; rejects `withOfflineQueue(transport)` (lines 56-59) and a public
request-layer seam (60-62). ADR-0010 header line 3-5 and ADR-0022:91 defer the queue. There are two files numbered
ADR-0022 (`0022-otlp-export-shares-one-delivery-core.md` and `0022-http-json-transport-delivery.md`).
