---
about: "createHttpTransport's offline queue saves the exact request body through OfflineQueue.saveBody with a per-save listener, because the queue's onDrop(reason, count) cannot name a failed save's events"
saw:
  - source/core/packages/observability/src/errors/transports/http-transport.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
  - source/core/packages/observability/src/delivery/offline/offline-queue.ts
  - docs/adr/0024-offline-queue-persists-encoded-bodies.md
---
`OfflineQueue.saveBody(body, count, reason, dropped)` (offline-queue.ts) reuses the `undelivered` save path but reports a
refused or failed save to `dropped`, not `onDrop`; `encode` is optional for a queue fed only by `saveBody`. The HTTP
transport's `giveUp` (http-transport.ts) calls it with the events in scope, so `onDrop(events, reason)` gets the real
events for `offline-full` or a failed write. The queue's own `onDrop` fires only for a body rejected on replay, which the
transport reports as `report([], "rejected")`: the body cannot be decoded back into events under a custom `serialize`.
A `retries-exhausted` body is the bytes `sendBatch` sent (`Settlement.body`, request.ts); a `closed` batch is re-encoded by
`encodeBatch`, which shares `encodeGroup`/`halves` with `settle`, so its split matches a real request. Replay uses the
transport's `classify` (408 retryable) via the queue's `classify` option, and async header thunks are awaited.
Every drop report, including the pre-open over-bounds `offline-full`, is asynchronous: `#save` tracks it as a write so
`settle`/`idle` wait for it.
