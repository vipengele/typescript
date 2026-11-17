---
name: http-transport-ignores-settlements-of-an-aborted-attempt
kind: invariant
description: createHttpTransport gives each batch its own AbortController so the unload drain can take the in-flight batch over, and onSettle drops any settlement whose own signal has aborted to avoid double-counting.
anchors:
  - path: source/core/packages/observability/src/errors/transports/http-transport.ts
    blob: 8f89e4d82bba
confidence: verified
---

In `source/core/packages/observability/src/errors/transports/http-transport.ts`, each batch runs
under `AbortSignal.any([stop.signal, attempt.signal])`, where `attempt` is a fresh controller per
batch and `stop` is the transport-wide one `close` aborts (`:250-252`).

`takePending` moves the unsettled in-flight events out and aborts only `attempt` (`:265-271`), so
the send loop carries on and the transport keeps working for a page that comes back from hidden.
`onSettle(settlement, signal)` returns early when that batch's own signal has aborted
(`:229-234`). Without the per-batch signal, a late settlement of the aborted attempt would count
events the drain already sent or gave up on, and flush waiters would be settled twice.

Any new path that takes events away from a batch in flight has to abort that batch's `attempt`
for the same reason.
