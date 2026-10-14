---
about: the logger and the reporter merge Scope, bindings and call attributes through one helper, but they differ on what a throw does
saw:
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - source/core/packages/observability/src/merge-attributes.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/errors/pipeline.ts
---
Issue #26 (child loggers + async attributes), as implemented.

- `mergeAttributes(layers)` (`src/merge-attributes.ts`) folds N layers least to most specific and
  renames a lower layer's `[Truncated: N more]` marker to a free `key#n` when a higher layer holds
  the same key. The reporter (`errors/pipeline.ts:124`, layers Scope, call) and the logger
  (`logger/emit.ts:53`, layers Scope, bindings, call) both call it, so `log.error` and
  `captureException` agree on the same Scope data. The rename only fires at the breadth bound, so
  its test needs 100+ keys per layer.
- Both read `normalizeAttributes(snapshot(Scope.current()))` inside their own guard that yields
  `{}` (`emit.ts:27`, `pipeline.ts:104`). `snapshot` omits the root, so Resource keys never leak.
  The logger's outer guard (`emit.ts:73`) still drops the record when the clock or the redaction
  policy throws; only the Scope read is exempt. A throwing Scope keeps the record.
- `Logger#with` (`logger/logger.ts`) holds an ordered list of binding layers. A static input is
  normalized and `freezeDeep`ed at `with()` time, and consecutive fixed layers merge into one
  (`childBindings`); a thunk is a lazy layer evaluated at the Logger's first written record.
  `createRecord` (`logger/emit.ts`) merges Scope, each layer in order, then the call; redaction runs
  at emit time over the whole merged record. A child reuses the parent's `resolve`/`emit` closures,
  so live level changes reach it, and no method uses `this`. `with({})` returns the parent; any
  thunk makes a new Logger. Bindings live in the closure, never at module level.
- Merged static layers form one layer whose size is not bounded by the per-layer breadth bound of
  100 that applies to a single normalized layer.
- The Scope is read on every record that passes the level check and has a sink; there is no
  opt-out. Without an async-context carrier (browsers today) Scope attributes are lost after an
  `await`, which is why ADR-0006 points to `with` across awaits.
