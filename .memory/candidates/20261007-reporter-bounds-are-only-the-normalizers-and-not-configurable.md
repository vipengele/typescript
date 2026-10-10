---
about: the reporter's per-value bounds are the five serializeError options, set by ReporterBuilder.limits and routed through pipeline.ts to normalizeAttributes, serializeError, the event message and each link's frames; the logger builder exposes no limits, and nothing bounds an event's total size
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/redaction.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
- `ReporterBuilder.limits` (`builder.ts`) takes `maxDepth`/`maxBreadth`/`maxStringLength`/`maxLinks`/`maxErrors`, validates each as a positive integer or `Infinity` (else `ReporterConfigError`) and keeps the builder unchanged on a throw. `ReporterSettings.limits` holds only the options set; `pipeline.ts` passes it to both `normalizeAttributes` calls and `serializeError`.
- The event `message` is cut by `toJsonSafe` at `maxStringLength` with the engine's `…[truncated]` suffix; each exception link's `frames` are capped at `maxBreadth`, first N kept, no marker. `pipeline.ts` keeps a local `DEFAULT_MAX_BREADTH = 100` mirroring serializeError's default, because common does not export it.
- The logger builder has no limits option; ADR-0007 states only the reporter's limits are builder-configurable.
- Units are depth levels, entries per container and UTF-16 code units per string; nothing counts bytes or total nodes, and the Transport owns wire limits (ADR-0010).
- `redactAttributes`/`redactError` still run with `UNBOUNDED` limits (`redaction.ts`) because a second pass under defaults would cut the normalizers' markers.
