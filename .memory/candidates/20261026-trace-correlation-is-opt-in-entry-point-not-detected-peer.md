---
about: "Trace correlation reads OpenTelemetry's globalThis registry (ADR-0021 amends ADR-0008's detection decision); the registry and span keys are API internals held only by trace.contract.test.ts, and ADR-0008's other four decisions still stand"
saw:
  - docs/adr/0021-trace-correlation-reads-the-otel-registry.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - source/core/packages/observability/src/logger/trace.ts
  - source/core/packages/observability/src/logger/trace.contract.test.ts
---
- `readActiveTrace` in `logger/trace.ts` reads `globalThis[Symbol.for('opentelemetry.js.api.1')].context.active().getValue(Symbol.for('OpenTelemetry Context Key SPAN')).spanContext()`; no shipped `src/` imports `@opentelemetry/api`. The package declares it only as an optional peer `^1.9` plus an exact-pinned devDependency for the contract test.
- Both keys are OpenTelemetry internals. `trace.contract.test.ts` registers a context manager on the real API and is the only thing that notices a key moving; widening the peer range means running it against the new versions. It cannot use `startActiveSpan`, because the API's no-op tracer yields all-zero ids, which the reader rejects.
- ADR-0021 amends only the detection decision of ADR-0008. Baggage by allowlist, bridge-or-export-never-both, exceptions as log records, and Scope and OTel Context being independent are still ADR-0008's, and no `@vipengele/ts/otel` entry exists.
- The reporter's `ErrorEvent.trace` (`errors/event.ts`) is still filled by nothing; the reader lives in the logger entry point.
