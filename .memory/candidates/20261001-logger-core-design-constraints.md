---
about: the logger's shape is already decided by ADR-0005/0007 (shared globalThis level table, warn default, Object.hasOwn validation, LoggingConfigError); common already exports Level/Threshold/SEVERITY_NUMBERS/isLevel
saw:
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - source/core/packages/common/src/levels/severity.ts
  - source/core/packages/common/src/levels/level.ts
  - source/core/packages/common/src/context/global-registry.ts
  - source/core/packages/observability/src/logger/index.ts
---
Cost: reading ADRs 0004-0007 plus common/levels and the registry.

- Level table must be shared: ADR-0005 "What two versions of the package share" keys it
  `Symbol.for('vipengele.logger.levels')` (dot style), format public and never incompatible; an unknown
  level name resolves to the nearest known one. Provider/Sink state is `Symbol.for('vipengele.logger.provider.v1')`.
  Only existing code precedent (global-registry.ts:30) uses `vipengele:async-context-store:<key>` (colon style).
  Naming mismatch is unresolved; the observability package has no globalThis use yet (grep of src/ found none).
- Default `'*': 'warn'` (ADR-0005 "Quiet by default"). `off` is a Threshold, not a Level (ADR-0007 "Levels").
- Level validation by `Object.hasOwn` already exists as `isLevel` in common (severity.ts:19-21); compare via
  `SEVERITY_NUMBERS` (severity.ts:6-13: 1,5,9,13,17,21). `Level`/`Threshold` are at common root (index.ts:5-7).
- Errors: bad level in code throws `LoggingConfigError` (ADR-0002 code + guard); bad entry in an env/URL/storage spec
  string is skipped with its own `warn` (ADR-0005 "How configuration changes"). Spec parsing from env is lazy
  (VPG_LOG), never at import ("sideEffects": false).
- ADR-0005 `override(cat, null)` removes one override; `configure` rebuilds whole and validates before swap.
- Logger and reporter share the Scope tree (ADR-0006), not level config; no ADR makes them share thresholds.
- logger/index.ts is `export {};` (empty stub); its test only checks the entry loads.
- Package scaffold: tsup entries logger+errors, `build` = tsup && tsc; 100% coverage thresholds in vitest.shared.ts.
