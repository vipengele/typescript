---
about: "a breadcrumb buffer belongs to the nearest child of the root, so tests asserting a trail must run inside Scope.isolated, and a batching-wrapped loggerSink records into the wrong Unit of Work"
saw:
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/scope/breadcrumbs.ts
  - source/core/packages/observability/src/errors/logger-sink.ts
  - source/core/packages/observability/src/logger/batching-sink.ts
  - docs/adr/0027-breadcrumbs-are-a-bounded-buffer-per-unit-of-work.md
---
`bufferFor` (`root.ts`) gives a child of the root a fresh buffer and any other child its parent's
array. So `Scope.isolated` and the default scope each start a trail, and `Scope.inherit` shares the
trail it is called under. The default scope's buffer is realm-wide and never cleared, because
attaching to an event only reads it. A test that records or asserts breadcrumbs outside
`Scope.isolated` therefore sees crumbs from earlier tests in the same file. Vitest's per-file
isolation keeps it from crossing files.

`reporter.loggerSink()` records into `Scope.current()` at `write` time (`logger-sink.ts`).
`createBatchingSink` calls `write` at flush, so a wrapped logger sink records, and attaches, the
trail of whichever Unit of Work is current at flush. The data looks valid, and no guard exists
(ADR-0027, "Hazard").
