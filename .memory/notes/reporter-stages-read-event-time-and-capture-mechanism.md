---
name: reporter-stages-read-event-time-and-capture-mechanism
kind: gotcha
description: Reporter pipeline stages take time from the enriched event (a test asserts the clock is read once per event) and take the unhandled bypass from the capture's mechanism argument, never from the processed event.
anchors:
  - path: source/core/packages/observability/src/errors/pipeline.ts
    blob: 6192fe976ca6
  - path: source/core/packages/observability/src/errors/pipeline.test.ts
    blob: 2e236beb8c64
confidence: verified
---

In `source/core/packages/observability/src/errors/pipeline.ts`:

- The Clock is read once, in enrich (`:298`). The rate limiter refills from `enriched.time`
  (`:473`). `pipeline.test.ts:390-393` wraps the clock in `vi.fn` to pin the single read, so a
  stage that calls `pipeline.clock()` again fails that test.
- The dedupe and rate-limit bypass for unhandled errors is `mechanism.handled === false` on the
  `mechanism` argument the capture was called with (`:466`), not on the event a processor or
  `beforeSend` returned. A processor therefore cannot flip `handled` to dodge the limiter, and a
  processor result without a `mechanism` cannot throw there.
