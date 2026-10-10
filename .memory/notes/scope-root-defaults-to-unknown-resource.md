---
name: scope-root-defaults-to-unknown-resource
kind: gotcha
description: The Scope tree's root starts from an all-undefined UNKNOWN_RESOURCE; Scope.setResource swaps the root's frozen attribute bag in place and skips undefined or non-string values, so a key can never be cleared.
anchors:
  - path: source/core/packages/common/src/scope/root.ts
    blob: 67a124a7505d
  - path: source/core/packages/common/src/scope/scope.ts
    blob: 4fd37ae2108c
confidence: verified
---

`getScopeTree()` (`root.ts:266`) builds the realm's tree on first access with
`createScopeTree(UNKNOWN_RESOURCE)` (`root.ts:72`, `:144`); its four reserved keys start `undefined`
and the root's bag is frozen (`root.ts:151`).

An application supplies a real Resource with `Scope.setResource` (`scope.ts:81`, `root.ts:177`). It
installs a new frozen bag on the existing root node (`root.ts:187`) and never replaces the tree, so
scopes already hanging off the root see the merged values. A key whose value is not a string
(including `undefined`) keeps the old value (`root.ts:185`), so a Resource key cannot be cleared
through the API. Anyone who read `Scope.resource()` earlier keeps the old snapshot.
