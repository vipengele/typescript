---
about: "The reporter's enrich stage fills ErrorEvent.trace from the shared src/trace.ts reader for every capture, and a trace left malformed by a processor or beforeSend is dropped (the event kept), unlike the logger, which drops the whole record"
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/observability/src/trace.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/otlp/encode-error-events.ts
  - docs/adr/0026-reporter-owned-logger-sink.md
---
- `readActiveTrace`, `LogTrace` and the guards `isTraceId`/`isSpanId`/`isTraceFlags` live in `src/trace.ts`, imported by `logger/emit.ts` and `errors/pipeline.ts` alike. `ErrorEvent.trace` is typed `LogTrace` (`errors/event.ts`).
- `enrich` (`errors/pipeline.ts`) sets `trace` through `traceOf(input)`: a `serialized-exception` input's own `trace` when given, else `readActiveTrace()`. No span means no `trace` key at all, not `trace: undefined`.
- `validateTrace` runs after processors and `beforeSend`, before dedupe and the transport: a `trace` that is not an object or fails a guard is deleted and the event kept; a valid one is rebuilt from its three fields. That keeps `otlp/encode-error-events.ts`, which calls `.toLowerCase()` on the ids, from ever seeing a malformed trace.
- The two sides differ on purpose: the logger's `acceptTrace` (`logger/emit.ts`) throws on a malformed processor trace, which drops the record for that processor's sinks (fail closed); the reporter drops only the field, because the error is still worth sending (ADR-0026).
- Redaction never touches `trace` on either side: it walks attributes and the error chain only.
