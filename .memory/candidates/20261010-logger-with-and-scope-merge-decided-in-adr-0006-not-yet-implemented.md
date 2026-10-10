---
about: logger.with(attrs) and Scope-attribute merge are already decided in ADR-0006; the logger emit path reads no Scope attributes yet
saw:
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/common/src/scope/root.ts
---
Checked for issue #26 (child loggers + async attributes).

- ADR-0006 section "A Logger's own bindings sit between the Scope and the call" (lines 44-50) fixes
  the API name `logger.with(attributes)` and the precedence: Scope chain root->innermost, then the
  Logger's bindings, then the call's; call wins. Bindings are lexical, never touch the Scope.
  Browser sync-stack caveat: ADR-0006 lines 80-85 point to `logger.with()` as the across-await answer.
- The logger does not read Scope attributes today: `emit.ts:1-4` imports only the `Resource` type
  from `./scope`; `grep snapshot|Scope.current` over non-test source hits only
  `errors/pipeline.ts:13,105`. `createRecord` (`emit.ts:26-49`) normalizes only the call's attrs.
- Mirror pattern: reporter `scopeAttributes` (`pipeline.ts:104-110`) = `normalizeAttributes(snapshot(Scope.current()), limits)`
  in try/catch -> `{}`; `mergeAttributes` (`pipeline.ts:132-138`) scope beneath call, with `key#n`
  renaming (`freeKey`) when a scope value is a truncation marker and the call has the same key.
  `snapshot` (`common/src/scope/root.ts:220`) omits the root, so Resource keys never leak.
  Asymmetry to decide: reporter swallows a Scope-read throw; logger drops the whole record on any
  record-building throw (`emit.ts:90-95`).
- Loggers are not cached: `provider.logger()` (`provider.ts:189-191`) calls `createLogger` each
  time; a Logger holds only category + `resolve` + `emit` closures (`logger.ts:44`), so a child
  just reuses the parent's closures and live reconfiguration is inherited free. The `Logger`
  interface is frozen and has no `with` yet (`logger.ts:24-37`; index.ts exports only the type).
- Level check precedes everything (`logger.ts:48`); no-sink check precedes record building
  (`emit.ts:84`), so Scope reads belong inside `createRecord`'s guard to stay lazy.
- Not found anywhere: a decision about `child`/`bind` naming beyond ADR-0006's `with`.
