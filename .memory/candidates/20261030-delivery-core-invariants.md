---
about: "the OTLP delivery core settles a batch exactly once, so every abort path settles in the same tick as the abort; limits merge per key so an explicit undefined keeps the default"
saw:
  - source/core/packages/observability/src/delivery/delivery.ts
  - source/core/packages/observability/src/delivery/unload.ts
  - source/core/packages/observability/src/delivery/delivery.test.ts
---
- `settle(batch, reason)` in `delivery.ts` reports a batch's outcome once and ignores later reports.
  `abandon` (close timeout) calls `inFlight.abort.abort()` and then `settle(inFlight, reason)`;
  `unloadDrain` calls `settle(batch, undefined)` and then `batch.abort.abort()`. Either order is safe
  because `settle` runs synchronously in the same tick as the abort: the aborted `retry.execute`
  rejects later, and by the time that rejection reaches `exportBatch`'s catch the batch is already
  settled, so the catch's `retries-exhausted` report is ignored rather than counting the entries twice.
- Limits are built key by key (`options.limits?.x ?? DEFAULT_DELIVERY_LIMITS.x`). A plain spread
  lets `{ scheduleDelayMs: undefined }` overwrite the default; `scheduler.sleep(undefined)` then
  rejects into a swallowed catch, so the timer export never fires and `flush` resolves `false` at once.
- The schedule-delay continuation acts only while `timer === controller`: a sleep that resolved just
  before `stopTimer` replaced it would otherwise clear the new timer's handle and force an early export.
- The unload drain sends exactly one `keepalive` fetch (`unload.ts` `largestFittingPrefix`, doubling
  the count from 1 until a prefix does not fit, then bisecting, so a backlog far over budget is never
  encoded whole): the 64 KiB keepalive budget is per document, so a second request is refused.
- While a `flush`/`close` waits, the backoff scheduler skips every sleep, `Retry-After` included.
