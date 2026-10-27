---
about: "ADR-0008 makes OpenTelemetry trace correlation an opt-in object from a ./otel entry point; no OTel code exists yet, so auto-attach on peer presence contradicts the ADR"
saw:
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - source/core/packages/observability/package.json
  - source/core/packages/observability/src/logger/record.ts
  - source/ts/packages/ts/package.json
---
Explored for issue #32 planning (2026-10-26).

- `grep -rIli 'opentelemetry|trace_id|traceId'` (excluding node_modules/dist): no source imports `@opentelemetry/api`; no package.json declares it (observability package.json has only a keyword; no peerDependencies/peerDependenciesMeta); `source/ts/packages/ts` has no `./otel` export (only `.`); no branch/log commit mentions otel. Only `trace?: {traceId; spanId; flags}` types exist: ADR-0007 for LogRecord and ErrorEvent, `errors/event.ts:25`; `logger/record.ts` LogRecord has NO `trace` field yet.
- ADR-0008: API is an optional peer (`^1.9`, `peerDependenciesMeta` optional), imported ONLY by `@vipengele/ts/otel`; correlation is opted in via `add(OtelTrace.correlation({baggage}))` on the logger and reporter builders. It explicitly rejects reading `globalThis[Symbol.for('opentelemetry.js.api.1')]` (detected global) and says always read traceId/spanId/flags into the record's `trace` field at record creation; baggage only by allowlist into attributes.
- ADR-0005 (~line 90): optional pieces are objects passed to `add`, not builder methods, because the core builder must not depend on OTel and `sideEffects:false` forbids patching prototypes.
- Consequence: "attach when peer present, nothing when absent" inside observability/logger would contradict ADR-0008 (static import in the core bundle, or detection). Plan must either implement ADR-0008's shape or amend the ADR.
