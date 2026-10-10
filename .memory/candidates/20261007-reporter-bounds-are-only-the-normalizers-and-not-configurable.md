---
about: the reporter's only size/depth bounds are the default limits of normalizeAttributes and serializeError, which pipeline.ts calls with no options; neither the reporter nor the logger builder exposes limits (ADR-0007 says builder-configurable), nothing bounds an event's total size, and message/frames/stack are unbounded and unredacted
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/redaction.ts
  - source/core/packages/common/src/attributes/normalize-attributes.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
  - source/core/packages/redaction/src/limits.ts
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
Checked while planning issue #43 (redaction and payload bounds).

- Redaction is already a stage (`redactEvent`, `pipeline.ts`, before processors; `ReporterBuilder.redaction(policy|null)`, `builder.ts`, same shape as `LoggingBuilder.redaction`). The issue's redaction half is largely implemented; only bounds are missing.
- The "bounded serializer" is `normalizeAttributes` (attributes; `NormalizeAttributesOptions` has `maxDepth`/`maxBreadth`/`maxStringLength`, defaults 6/100/8192 chars) plus `serializeError`, which takes a `SerializeErrorOptions` (those three plus `maxLinks` 5 and `maxErrors` 100). `pipeline.ts` calls both with no options, so the reporter only ever uses the defaults. `grep -il 'maxDepth|limits' observability/src` hits only `redaction.ts`, i.e. no builder option on either logger or reporter, although ADR-0007 (~line 114) says limits are builder-configurable.
- Units are depth levels, entries per container and UTF-16 code units per string; nothing counts bytes or total nodes (serialize-error-link-counting already notes width x depth has no total budget). Frames from `parseStack` and the event `message` are not bounded by any of this.
- `redact()` in `redactAttributes`/`redactError` runs with all limits `Infinity` (`redaction.ts` UNBOUNDED) because a second pass under defaults would cut the normalizers' markers; so redact's own limits (`limits.ts`, markers `[Truncated]`, `[Truncated: N more]`, `…[truncated]`, key `…`) are deliberately unused in the reporter.
- redact-limits-duplicate-tojsonsafe-and-diverge-on-nan: still-true for limits.ts header and defaults (6/100/8192, same markers); engine.ts defaults are now at lines 12-14, not 12-17.
