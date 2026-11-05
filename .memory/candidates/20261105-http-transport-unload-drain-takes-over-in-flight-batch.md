---
about: "createHttpTransport's unload drain takes over the batch in flight by aborting a per-attempt AbortController; onSettle ignores any settlement whose own signal has aborted"
saw:
  - source/core/packages/observability/src/errors/transports/http-transport.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
  - source/core/packages/observability/src/delivery/unload.ts
  - docs/adr/0023-http-json-transport-delivery.md
---
Each batch in `startSending`'s loop (http-transport.ts) runs `sendBatch` under
`AbortSignal.any([stop.signal, attempt.signal])`, where `attempt` is a fresh `AbortController` per batch and
`stop` is the transport-wide one `close` aborts. `unloadDrain` → `takePending` moves the unsettled `inFlight`
events out and aborts `attempt`, so the loop carries on (stop is not aborted) and the transport keeps working
for a page that comes back. `onSettle(settlement, signal)` returns early when that batch's own signal has
aborted: without the per-batch signal, a late settlement of the aborted attempt would count events the drain
already sent or gave up on, double-settling flush waiters.
The keepalive request carries only the leading run sharing the oldest event's Resource (`splitForUnload`),
because `serialize(events, resource)` takes one Resource per body, and it keeps `maxBatchEvents`/`maxBatchBytes`
on top of `UNLOAD_BUDGET_BYTES` (`fittingPrefix`). The leftover goes to `loseToUnload`: `giveUpEncoded(...,
"unload-budget")` → `offline.queue.saveBody` with offline on, else `onDrop(events, "unload-budget")`.
`sendKeepalive` (request.ts) returns false (→ "unsendable") only when there is no fetch or a headers function
throws synchronously; an async headers promise delays the POST and a rejected one sends nothing, unreported.
The 64 KiB budget is not coordinated with OTLP queues in the same document (ADR-0023 unload section).
