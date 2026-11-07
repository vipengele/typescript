---
about: "Scope.tag (the Breadcrumb) is never read by the reporter or logger; CONTEXT.md/ADR-0006 describe a trail walk that is not implemented"
saw:
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/scope/scope.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/logger-sink.ts
  - docs/adr/0006-scope-tree.md
  - CONTEXT.md
---

`grep -rn '\.tag\b|breadcrumb' -i source/core/packages/observability/src --include=*.ts` (non-test) -> 0 hits.
`snapshot()` (root.ts:251-287) copies only ATTRIBUTES bags of non-root nodes; `tag` is not read. Pipeline `scopeAttributes` (pipeline.ts:~190) uses snapshot, so an Error Event carries no tag/trail. ErrorEvent (errors/event.ts) has no breadcrumb field.
CONTEXT.md:233-237 and ADR-0006:~109 say the trail is "the tagged ancestors walked from the root down" - that is documented intent, not behaviour.

Scope structure: TreeScope has Symbol.for slots PARENT/ATTRIBUTES (root.ts:69-71,106-135). inherit = child of current() with its own attribute bag, get() chains to ancestors (root.ts:118-129; scope.ts:344). isolated = child of root.ts getScopeTree().root (scope.ts:355). The default scope is also a child of root (root.ts:177), so "Unit of Work boundary" = the non-root ancestor whose PARENT is root; no explicit notion exists. setTag/setContext/setUser all write the current scope's own bag via writeAll (scope.ts:393-401); on root, assertSettable throws ReservedScopeKeyError (root.ts:146-154); the default scope is mutable (root.ts:158-160) and shared realm-wide.
