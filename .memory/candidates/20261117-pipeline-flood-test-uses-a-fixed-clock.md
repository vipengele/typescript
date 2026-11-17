---
about: "the reporter flood test injects a fixed clock, so its rate limit cannot refill from wall time"
saw:
  - source/core/packages/observability/src/errors/pipeline.test.ts
targets:
  - pipeline-flood-test-refills-from-wall-clock
verdict: stale
---
The test "is delivered after a loop of handled errors floods the reporter"
(`source/core/packages/observability/src/errors/pipeline.test.ts:~1013-1035`) now builds its reporter with
`b.clock(() => 1)`, so the default rate limit (burst 60, 60 per minute) cannot refill during the
500-error loop, and it delivers exactly 61 events however long the loop takes. `aDedupingReporter`
(`:838-841`) itself still has no injected clock, so any other test that relies on the default
rate limit through it still refills from wall time.
