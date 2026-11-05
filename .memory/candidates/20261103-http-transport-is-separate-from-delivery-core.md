---
about: "createHttpTransport (http-transport.ts) does not use the delivery core (createDelivery): own queue, own retry, own unload drain, own JSON envelope wire format and own DropReason; it reuses only src/delivery/unload.ts helpers and the offline queue"
saw:
  - source/core/packages/observability/src/errors/transports/http-transport.ts
  - source/core/packages/observability/src/errors/transports/http/queue.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
  - source/core/packages/observability/src/errors/transports/otlp-transport.ts
  - docs/adr/0023-http-json-transport-delivery.md
---
`grep createDelivery|onDrop` in src (non-test): delivery.ts, otlp-transport.ts:58-66, logger/otlp-sink.ts:56-64 use the core;
http-transport.ts imports `createEventQueue` (http/queue) and `sendBatch` (http/request) instead (:3-5). It has its own
`DropReason` (queue-full, too-large, retries-exhausted, rejected, unsendable, closed, unload-budget, offline-full), `onDrop(events, reason)` which DOES
hand over the ErrorEvents (http/options.ts:44; http-transport.ts:59-70), body `{"resource","events"}` (ADR-0023
lines 24-26), its unload drain (`unloadDrain`, http-transport.ts) is its own code but reuses `watchUnload`, `largestFittingPrefix` and `UNLOAD_BUDGET_BYTES` from delivery/unload.ts, with a `lifecycle` option (http/options.ts) also passed to `openOffline`. With its
`offline` option it saves bodies through `OfflineQueue.saveBody` (delivery/offline/offline-queue.ts), not through the core. ADR-0010 prose says unload+offline are options of "the HTTP JSON Transport"; ADR-0022-otlp says the HTTP
Transport shares the core, but the built one does not, and `createOtlpTransport` is the core-backed one. So an offline
queue under the core needs the internal `undelivered` hook (ADR-0024); the HTTP transport hands events out through its own onDrop
and calls `saveBody` itself (http-transport.ts `giveUp`).
Error Event and Resource are structured-cloneable: `ErrorEvent` (errors/event.ts) is plain data, `Attributes` is
`Readonly<Record<string, JsonSafeValue>>` (common/src/attributes/attribute-value.ts:8-11), `Resource` is 11 string|undefined
keys (common/src/scope/root.ts:13-24); freezing does not affect structuredClone. Persisting the encoded body string avoids
needing the encoder's inputs but fixes batch composition and loses re-budgeting for the 64 KiB unload prefix.
