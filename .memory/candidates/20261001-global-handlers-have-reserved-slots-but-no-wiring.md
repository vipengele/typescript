---
about: global error handlers (issue #38) have a reserved data-model slot and a documented extension pattern, but no wiring in the Reporter yet
saw:
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
---
Read for the planning of issue #38; every claim below was read in the file named.

Decided:
- `Mechanism.source` already reserves `"global.error"` and `"global.rejection"`, and
  `integration.<name>` (event.ts:39; ADR-0007 "What an Error Event adds"). `handled: false` is the
  unhandled signal. `level` doc says "`error` unless the process is going down" (event.ts:16,
  ADR-0007) but nothing sets `fatal` yet.
- `createCapture` doc (pipeline.ts, above `createCapture`) says it serves "any handler that hands
  the reporter an error with its own Mechanism"; reporter.ts hard-codes `CAPTURED` (handled:true,
  source:"capture") and exposes no public capture-with-mechanism. A handler needs `createCapture`
  or a new Reporter method.
- Optional pieces are objects passed to `builder.add(...)`, never builder methods, when they carry
  weight or a dependency (ADR-0005 "Why optional pieces are objects"; ADR-0008 example
  `createReporter(b => b.add(OtelTrace.correlation(...)))`). Core capabilities are builder methods.
- `createReporter` doc: "Creating one installs nothing" (reporter.ts); `"sideEffects": false`
  forbids install-on-import (ADR-0005).

Open / not built (as of 2026-10-01): `ReporterBuilder` has only `transport` and `clock`
(builder.ts); `add` does not exist; `createCapture` is called with `processors: [], filters: []`
(reporter.ts). No ADR or rule mentions "integrations" as a Reporter concept beyond the
`integration.<name>` source string; `grep -rniE "integration|installGlobal|uncaught|unhandled" docs agentic`
shows nothing else. No ADR decides an exit policy; ADR-0004 only lists "process exit hooks" as a
lazily detected capability.

Pipeline is fully synchronous (pipeline.ts `Processor`/`Filter` return values, not promises;
`deliver` reduces them synchronously). Scope is NOT read by the pipeline today: `enrich` uses only
`input.attributes` (pipeline.ts `enrich`), despite ADR-0006's claim that the reporter reads Scope.
