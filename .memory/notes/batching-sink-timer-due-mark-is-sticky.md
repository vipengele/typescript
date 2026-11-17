---
name: batching-sink-timer-due-mark-is-sticky
kind: rationale
description: "The batching sink keeps a sticky #timerDue mark until its buffer empties, because re-arming the timer on settle would make overdue records wait a second full interval."
anchors:
  - path: source/core/packages/observability/src/logger/batching-sink.ts
    blob: 9fca4b85832e
confidence: verified
---

`BatchingQueue` in `source/core/packages/observability/src/logger/batching-sink.ts` keeps one
batch in flight. When the `scheduleDelayMs` sleep resolves while a batch is in flight,
`#timerElapsed` cannot start one; it sets `#timerDue` (`:352-360`) and the next `#pump` hands the
buffer on at once (`:320-327`). Arming a fresh timer on settle instead makes a record wait the
in-flight time plus a whole extra interval.

Two details carry the behaviour:

- The mark survives a partial batch: `this.#timerDue &&= this.#buffer.length > 0` (`:277`).
  Clearing it unconditionally strands the tail of a backlog larger than `maxBatchSize` behind
  another full interval.
- `#stopTimer` (`:332`) does not clear the mark; only the paths that empty the buffer do
  (`:297`, `:376`). A `flush` that times out with a batch in flight keeps it.
