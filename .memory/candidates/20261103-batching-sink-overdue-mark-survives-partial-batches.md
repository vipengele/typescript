---
about: "the batching sink's interval can come due while a batch is in flight; a sticky #timerDue mark, kept until the buffer empties, is what stops overdue records waiting a second full interval"
saw:
  - source/core/packages/observability/src/logger/batching-sink.ts
  - source/core/packages/observability/src/logger/batching-sink.test.ts
  - source/core/packages/observability/src/delivery/delivery.ts
---
- `BatchingQueue` keeps one batch in flight. When the `scheduleDelayMs` sleep resolves while a
  batch is in flight, `#timerElapsed` cannot start a batch; it sets `#timerDue` and the settle's
  `#pump` hands the buffer on at once (`batching-sink.ts`, `#timerElapsed`, `#pump`). Re-arming a
  fresh timer on settle instead makes a record wait in-flight time plus a whole extra interval.
- `#startBatch` keeps the mark only while the splice leaves records behind
  (`this.#timerDue &&= this.#buffer.length > 0`). Clearing it unconditionally strands the tail of
  a backlog larger than `maxBatchSize` behind another full interval. `#hideDrain` and `#abandon`
  empty the buffer and clear it.
- `#stopTimer` does not clear the mark, so a `flush` that times out with a batch in flight keeps
  it. A timed-out flush does abort a not-yet-elapsed timer, and the post-drain `#pump` arms a
  fresh full interval for what is left.
- `delivery.ts` solves the same problem with its own `#timerDue` plus per-entry `observedMs`; the
  batching sink cannot reuse `createDelivery` (see the generic-batching-sink candidate).
- Tests pinning this: "hands records the timer came due for during a batch in flight on as that
  batch settles", "hands an overdue backlog larger than maxBatchSize on batch by batch as each
  settles, arming no timer", "waits a whole interval again for records written after the overdue
  ones went on" (`batching-sink.test.ts`).
