---
name: pipeline-flood-test-refills-from-wall-clock
kind: gotcha
description: The reporter test 'is delivered after a loop of handled errors floods the reporter' uses the real clock for the rate limit, so under load it can deliver 62 events instead of the asserted 61.
anchors:
  - path: source/core/packages/observability/src/errors/pipeline.test.ts
    blob: 2e236beb8c64
confidence: verified
---

`aDedupingReporter` (`source/core/packages/observability/src/errors/pipeline.test.ts:838-841`)
builds `createReporter` with no injected clock, so the default rate limit (burst 60, 60 per
minute) refills from wall time. The flood test (`:1013-1029`) captures 500 handled errors, then
one unhandled, and expects exactly 61 delivered events.

When the loop takes over a second a token refills and 62 arrive. That was observed at about
1.2 s under a parallel `turbo run test`; the test passes when run alone. It is load sensitivity,
not a logic failure: rerun before investigating. The fix is to inject a fixed clock into that
reporter, as the test at `:951` does.
