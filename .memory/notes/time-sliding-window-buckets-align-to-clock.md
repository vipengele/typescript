---
name: time-sliding-window-buckets-align-to-clock
kind: gotcha
description: The circuit breaker's time sliding window indexes buckets by absolute clock time, so an outcome can leave the window up to one bucket before the full window size has passed.
anchors:
  - path: source/core/packages/resilience/src/circuit-breaker/sliding-window.ts
    blob: e3e0f4fa63fc
confidence: verified
---

`createTimeWindow` in
`source/core/packages/resilience/src/circuit-breaker/sliding-window.ts` uses buckets of
`max(1, ceil(size / TARGET_BUCKETS))` ms (`:78-79`) indexed by `floor(clock() / bucketMs)`
(`:135-136`), not by the time of the first record. An outcome therefore stays in the window for
somewhere between `(n-1) * bucketMs` and `n * bucketMs`. A test must not assume it survives
exactly `size` ms; pick clock values on bucket boundaries or assert with a bucket of slack.

Clock movement: a jump of at least the bucket count resets the whole window (`:108`); a clock
that stands still or steps back (`steps <= 0`, `:104`) records into the newest bucket and evicts
nothing.
