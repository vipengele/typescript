---
about: scope-root-defaults-to-unknown-resource re-checked
saw:
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/observability/src/logger/logging.ts
targets: scope-root-defaults-to-unknown-resource
verdict: still-true
---
`grep -rn "createScopeTree\|UNKNOWN_RESOURCE" common/src` (non-test): `root.ts:72` defines it, `root.ts:130` defines `createScopeTree`, `root.ts:215` is the only call, with `UNKNOWN_RESOURCE`. Nothing supplies a real Resource. The logger reads it via `Scope.resource` (`logging.ts:78,120`). Line numbers in the note body are unspecific, so none drifted.
