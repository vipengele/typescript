---
about: "Reporter pipeline gotchas: the rate-limit bucket must refill from event.time because the clock is asserted to be read once per event, the unhandled bypass reads the capture mechanism not the processed event, and dedupe state is per capture function"
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/rate-limit.ts
  - source/core/packages/observability/src/errors/dedupe.ts
  - source/core/packages/observability/src/errors/pipeline.test.ts
  - docs/adr/0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md
---
- `pipeline.test.ts` ("reads the Resource once per event") wraps the clock in `vi.fn` and asserts it is called once, so a stage that needs time must read `enriched.time`, which enrich stamps from the Clock. `run()` in `pipeline.ts` passes `enriched.time` to `RateLimiter#take`; a second `clock()` call fails that test.
- The `mechanism.handled === false` bypass of dedupe and the rate limit reads the `mechanism` argument `createCapture` was called with, never the event a processor or `beforeSend` returned (`pipeline.ts`, `run()`). A processor can therefore not flip `handled` to dodge the limiter, and a processor result with no `mechanism` cannot throw there.
- Dedupe's last-passed event is recorded when an event passes dedupe even if the rate limiter then drops it, and an unhandled event never becomes the last one (`dedupe.ts`, `pipeline.ts` stages 9 and 10). The deduper and limiter are created per `createCapture` call, so two reporters never share them.
- `RateLimiter#take` ignores a `time` earlier than the latest seen (no negative refill, no double refill) and carries fractional tokens (`rate-limit.ts`). `rateLimit({ burst })` only requires a positive finite number, so a burst below 1 accepts the config and then drops every handled event.
- A processor or `beforeSend` result that is not an object (undefined, string, false) drops the event, like `null` (`applyProcessor` in `pipeline.ts`).
- ADR-0020 fixes who owns drops: the Reporter owns policy drops, the Transport delivery drops; ADR-0010's "decision to drop" means delivery drops only.
Established by reading the files above while landing issue #42.
