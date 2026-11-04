---
about: "the logger has no sampling or rate-limit stage; the only token bucket is errors/rate-limit.ts and its state is per-capture, not shared across package copies"
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/errors/rate-limit.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - docs/adr/0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md
---
Explored for the issue "sampling and rate limiting of records" for the logger.

- Logger.log (logger.ts bindLogger, `log`) does level check then `emitRecord`; emitRecord (emit.ts) returns on `sinks.length === 0`, then ONE guard runs createRecord (clock, scope, bindings, call thunk, serializeError, redaction, trace), global processors, then `settings.resource()`; then per sink: per-sink processors, `sink.write` in its own try (reportFailure -> onSinkError). Attribute thunk runs inside createRecord, so a drop before createRecord skips the thunk (ADR-0019), a drop in a processor happens after it.
- Only token bucket: errors/rate-limit.ts `createRateLimiter({burst, perMinute})`, `take(epochMs)`, lazy refill from event time, no clock/timer. Not in common/resilience (grep "token bucket" hits only errors/). Instance per `createCapture` (pipeline.ts), not a globalThis slot.
- Reporter sampling: `sampleRate` + injectable `random` (builder.ts `random()`, default Math.random), pipeline.ts `isSampled`. Drops are silent and uncounted (ADR-0020). Logger builder has `clock` but no random.
- Category resolution: levels.ts resolveEntry, longest dotted prefix then `*` (categories.ts governingKeys); level tables are `{level, severity}` only, spec `cat:level` (spec.ts) carries nothing else, so per-category sampling cannot ride the level table/slot without a protocol change (ADR-0005 says the table format never changes incompatibly).
