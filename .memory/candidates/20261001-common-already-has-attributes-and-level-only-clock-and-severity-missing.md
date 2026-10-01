---
about: issue #16's Level and Attributes already exist in common with a different Attributes shape than OTel's; only the severity-number table and a shared Clock are missing, and observability keeps a local Clock
saw:
  - source/core/packages/common/src/index.ts
  - source/core/packages/common/src/levels/level.ts
  - source/core/packages/common/src/attributes/attribute-value.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/package.json
  - source/core/packages/common/package.json
  - source/core/packages/common/tsup.config.ts
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
---

Checked while planning issue #16.

- `Level`/`Threshold` are type-only at the root (`common/src/index.ts:6`, `levels/level.ts`). The
  OTel numbers (trace 1, debug 5, info 9, warn 13, error 17, fatal 21) are recorded only in
  ADR-0007's mapping table and "Levels" section ("each at the base of its OTel severity range");
  no runtime table exists in common. Observability keeps its own `LEVELS` + `Object.hasOwn` in
  `observability/src/errors/pipeline.ts:36-47`.
- `Attributes` already exists, exported at root and from `./attributes`, but it is
  `Readonly<Record<string, JsonSafeValue>>` (nested objects/arrays/null allowed), per ADR-0007.
  ADR-0007 explicitly rejects "primitive-only attributes, as for OTel span attributes". Issue #16's
  "string|number|boolean|homogeneous arrays" definition contradicts the ADR; do not redefine it.
- Clock: observability's `ReporterBuilder.clock()` and `type Clock = () => number` are local to
  `observability/src/errors/builder.ts:4,35`; default is `performance.timeOrigin + performance.now()`
  (builder.ts:17). ADR-0007: time = epoch ms with sub-ms fraction, "from an injectable clock",
  injected through the builder (explicitly, not a global).
- ADR-0008: `@opentelemetry/api` is an optional peer used only by `@vipengele/ts/otel`; common has
  no dependencies at all (`common/package.json`), so the severity map must be self-contained.
- Observability depends on common by `workspace:*` (same project), so a common change and the
  observability migration can be one PR/one build graph; cross-project pins/links (ADR-0009) only
  concern `source/ts`, which would need no change unless it re-exports the new names.
- A new sub-path needs three edits: `exports` entry in `common/package.json`, entry in
  `common/tsup.config.ts`, and a test (index.test.ts covers only root).
- Coverage: `source/core/vitest.shared.ts` enforces 100% v8 thresholds on Node+Chromium union;
  `.lydite/components.yml` has `core-common` as one component, no per-subpath config needed.
