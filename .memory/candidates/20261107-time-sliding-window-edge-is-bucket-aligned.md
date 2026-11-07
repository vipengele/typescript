---
about: "the circuit breaker's time sliding window aligns buckets to absolute clock time, so an outcome can leave the window up to one bucket before size ms have passed"
saw:
  - source/core/packages/resilience/src/circuit-breaker/sliding-window.ts
  - source/core/packages/resilience/src/circuit-breaker/sliding-window.test.ts
---
- `createTimeWindow` uses buckets of `max(1, ceil(size / 100))` ms indexed by `floor(clock() / bucketMs)` (`bucketOf`), not by the time of the first record. An outcome stays in the window between `(n-1)*bucketMs` and `n*bucketMs` after it is recorded, so a test must not assume it survives exactly `size` ms.
- A clock jump of at least the bucket count resets the whole window; a clock stepping back (`steps <= 0`) records into the newest bucket and evicts nothing.
- `createSlidingWindow` treats any type other than `"count"` as a time window; rejecting an unknown type is `validateCircuitBreakerConfig`'s job (`config.ts`).
