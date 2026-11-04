---
about: "ErrorEvent.trace is typed, encoded by OTLP and documented in ADR-0007, but the reporter pipeline never populates it; only the logger reads the OTel span"
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/observability/src/logger/trace.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/otlp/encode-error-events.ts
  - docs/adr/0021-trace-correlation-reads-the-otel-registry.md
---
Found while scoping issue #47 (logger integration: "share context and trace ids").

- Scope sharing is real: `errors/pipeline.ts:191` (`enrich`) and `logger/emit.ts:119` both call `mergeAttributes` over `normalizeAttributes(snapshot(Scope.current()))`.
- Trace sharing is NOT: `grep -rn "\.trace\|trace:" src/errors` (non-test) -> 0 hits in the pipeline. `enrich` builds `{id,time,level,payload,mechanism,attributes}` only. `readActiveTrace()` (`logger/trace.ts:80`, ADR-0021) is called only from `logger/emit.ts:121`. `ErrorEvent.trace` (`event.ts:25`) and `otlp/encode-error-events.ts:58` already handle it, so an event simply never has one.
- Closing the gap means calling a trace read from `enrich`. `readActiveTrace` lives in `src/logger/`; `errors/` importing it (or a shared move to `src/`) is allowed by the package, nothing forbids it, but it makes errors depend on logger files.
