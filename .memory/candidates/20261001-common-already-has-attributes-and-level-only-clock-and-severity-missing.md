---
about: common's Attributes is JSON-safe-valued and deliberately not OTel's primitive-only shape; the severity table and Clock are root exports with no OTel dependency, and a new sub-path would need three edits
saw:
  - source/core/packages/common/src/index.ts
  - source/core/packages/common/src/attributes/attribute-value.ts
  - source/core/packages/common/package.json
  - source/core/packages/common/tsup.config.ts
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
---

- `Attributes` is exported at root and from `./attributes` as `Readonly<Record<string,
  JsonSafeValue>>` (nested objects/arrays/null allowed), per ADR-0007, which explicitly rejects
  "primitive-only attributes, as for OTel span attributes". Do not redefine it to the OTel shape.
- `SEVERITY_NUMBERS`, `SeverityNumber`, `isLevel`, `Clock` and `systemClock` are root exports of
  common (`index.ts`), alongside `Level`/`Threshold`. ADR-0008: `@opentelemetry/api` is an
  optional peer used only by `@vipengele/ts/otel`; common has no dependencies at all
  (`common/package.json`), so the severity numbers are a self-contained table.
- A new sub-path needs three edits: an `exports` entry in `common/package.json`, an entry in
  `common/tsup.config.ts`, and a test (`index.test.ts` covers only the root).
- Observability depends on common by `workspace:*` (same project), so a common change and the
  observability migration build in one graph; cross-project pins/links (ADR-0009) only concern
  `source/ts`, which needs no change unless it re-exports the new names.
