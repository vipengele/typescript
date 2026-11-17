---
name: hot-path-heap-test-discards-attempts-a-gc-ran-in
kind: gotcha
description: The logger's disabled-call heap test cannot assert heap growth one-sidedly, because a GC during the loop hides allocations; it observes GCs and needs one GC-free attempt under 256 KB.
anchors:
  - path: source/core/packages/observability/src/logger/hot-path.node.test.ts
    blob: be79c9c67ecd
confidence: verified
---

`source/core/packages/observability/src/logger/hot-path.node.test.ts` checks that a disabled log
call allocates nothing by measuring heap growth over a loop. A GC inside the measured loop frees
what the loop allocated, so an allocating call can show small or even negative growth (the
explorer saw 1.7 MB, 4.8 MB and -3.4 MB across three attempts of the same code).

The test therefore watches GCs with a `PerformanceObserver` on `entryTypes: ["gc"]` (`:22,58`),
discards any attempt a GC started in, and passes on one clean attempt under `MAX_GROWTH_BYTES`,
256 KiB (`:18`). Simplifying it to a single measurement, or to "growth below X", makes it both
flaky and blind.
