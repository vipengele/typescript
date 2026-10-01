---
name: scope-root-defaults-to-unknown-resource
kind: gotcha
description: The Scope tree's root is built lazily from an all-undefined UNKNOWN_RESOURCE, and nothing yet supplies a real Resource.
anchors:
  - path: source/core/packages/common/src/scope/root.ts
    blob: e96f969a5620
confidence: verified
---

`getScopeTree()` (`root.ts`, end of file) builds the realm's tree on first access with
`createScopeTree(UNKNOWN_RESOURCE)`, whose four keys (`service.name`, `service.version`,
`deployment.environment.name`, `process.runtime.name`) are all `undefined` (`UNKNOWN_RESOURCE`
in `root.ts`). The root's attributes are frozen once built (`createScopeTree`), so a real
Resource cannot be supplied afterwards. As of this note, `createScopeTree`/`getScopeTree` are only
referenced from the scope module and its tests — no init path passes a real Resource.

Whoever wires logger/reporter init must build the tree with a real Resource before the first
`getScopeTree()` (which `getScopeStore()` in `store.ts` triggers), or every record silently reports
`undefined` for all four fields.
