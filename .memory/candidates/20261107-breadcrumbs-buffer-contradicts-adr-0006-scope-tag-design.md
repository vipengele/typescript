---
about: "issue #48 (a breadcrumb ring buffer on the Reporter) contradicts ADR-0006/0007/0022 and CONTEXT.md, which define a Breadcrumb as a Scope tag with no buffer"
saw:
  - CONTEXT.md
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
  - docs/adr/0026-reporter-owned-logger-sink.md
  - source/core/packages/observability/src/errors/pipeline.ts
---
`grep -i breadcrumb` over CONTEXT.md and docs/adr: CONTEXT.md (Breadcrumb, ~233) and ADR-0006:27 say a scope's tag IS its Breadcrumb, with "no separate record and no buffer"; ADR-0007:48,150 mark `breadcrumbs: Breadcrumb[]` superseded; ADR-0022:66 says Error Events carry no breadcrumbs, so OTLP maps none; observability README:1070 repeats it. A ring buffer plus `beforeBreadcrumb` needs those superseded (new ADR) first.

Logger->reporter bridge precedent is ADR-0026: `Reporter#loggerSink()` is an ordinary Sink; `src/logger/` never imports `src/errors/` (enforced by `src/logger/no-errors-import.node.test.ts`); `errors/` imports only types from `logger/`. Auto-recording Log Records as breadcrumbs would follow the same Sink route.

Pipeline (ADR-0020): enrich is stage 5, before redaction (6), processors (7), beforeSend (8); dedupe compares fingerprint or message/top exception/frames only, not attributes, so breadcrumbs would not affect it. `enrich` is `pipeline.ts:237`.
Not verified: no abandoned breadcrumb attempt found in candidates or notes.
