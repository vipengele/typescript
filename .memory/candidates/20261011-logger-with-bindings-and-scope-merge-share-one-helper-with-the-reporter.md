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
- `Logger#with` (`logger/logger.ts:74`) normalizes and `freezeDeep`s the folded bindings once, at
  `with()` time; redaction runs at emit time over the whole merged record. A child reuses the
  parent's `resolve`/`emit` closures, so live level changes reach it, and no method uses `this`.
  `with({})` returns the parent. Bindings live in the closure, never at module level.
- Nested `with` folds each level into one bindings object, so its size is not bounded by the
  per-layer breadth bound of 100 that applies to a single normalized layer.
- The Scope is read on every record that passes the level check and has a sink; there is no
  opt-out. Without an async-context carrier (browsers today) Scope attributes are lost after an
  `await`, which is why ADR-0006 points to `with` across awaits.
