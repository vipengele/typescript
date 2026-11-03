---
about: "the reporter test 'is delivered after a loop of handled errors floods the reporter' uses the real clock for the rate limit and can see 62 events instead of 61 under load"
saw:
  - source/core/packages/observability/src/errors/pipeline.test.ts
---
`aDedupingReporter` (`pipeline.test.ts`) builds `createReporter` with no injected clock, so the
default rate limit refills from wall time. The test captures 500 handled errors then one unhandled
and expects exactly 61 delivered events; when the loop takes over a second (seen at 1212 ms under a
parallel turbo run in node) a token refills and 62 arrive. Rerunning in isolation passes. A fix
injects a fixed clock into that reporter.
