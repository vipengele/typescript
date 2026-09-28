---
about: source/core/packages/common/src/scope/root.ts
saw: |
  Reading root.ts and store.ts while implementing issue #70 (the Scope tree). `getScopeTree()`
  lazily builds the realm's one root scope from `UNKNOWN_RESOURCE`, a placeholder Resource whose
  four fields (`service.name`, `service.version`, `deployment.environment.name`,
  `process.runtime.name`) are all `undefined`. No code anywhere in the framework yet supplies a
  real Resource before the tree's first access.
---

Nothing in `@vipengele/ts-core-common` or `@vipengele/ts-core-observability` yet initializes the
Scope tree's root with a real `Resource`. `getScopeTree()` in `root.ts` falls back to
`UNKNOWN_RESOURCE` (all four reserved keys `undefined`) on first access, and the root is immutable
once built — there is no way to supply a real Resource afterward without restarting the process.

Any future logger/reporter initialization path that wants `service.name` etc. on log records or
error events has to build the tree with a real Resource *before* anything calls `Scope.current()`,
`Scope.inherit(...)`, or similar — none of which exist yet. Whoever wires that up should replace
`getScopeTree()`'s lazy-default behavior with an explicit init call, or accept that a process which
never explicitly initializes it silently reports `undefined` for all four Resource fields forever.
