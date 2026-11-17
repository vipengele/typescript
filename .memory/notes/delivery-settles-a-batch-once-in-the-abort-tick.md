---
name: delivery-settles-a-batch-once-in-the-abort-tick
kind: invariant
description: The OTLP delivery core settles a batch exactly once, so every path that aborts a batch must settle it synchronously in the same tick as the abort.
anchors:
  - path: source/core/packages/observability/src/delivery/delivery.ts
    blob: 97fd72be6151
confidence: verified
---

In `source/core/packages/observability/src/delivery/delivery.ts`, `#settle` records a batch's
outcome once and ignores any later report (`:316-320`). The close-timeout path aborts then
settles (`:468-469`); the unload drain settles without a reason then aborts (`:516-517`). Either
order is safe only because both happen in one tick: the aborted export rejects later, and by the
time that rejection reaches the export's own `#settle(batch, "retries-exhausted")` (`:389`) the
batch is already settled, so its entries are not counted twice.

An `await` between an abort and its settle breaks this: the stale `retries-exhausted` report wins
and the entries are reported as a drop the caller already accounted for.

Related: limits are merged key by key with `??` (`:182-187`), not spread, so an explicit
`{ scheduleDelayMs: undefined }` keeps the default instead of reaching `scheduler.sleep`.
