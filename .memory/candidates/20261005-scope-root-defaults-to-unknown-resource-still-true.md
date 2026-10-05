---
about: the scope root starts from an all-undefined Resource and Scope.setResource is the one way an application changes it; it swaps the root's attribute bag in place on the existing root node
saw:
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/scope/scope.ts
  - source/core/packages/observability/src/logger/logging.ts
targets: scope-root-defaults-to-unknown-resource
verdict: now-false
---
- `root.ts`'s `getScopeTree` builds the tree lazily from `UNKNOWN_RESOURCE` (all four reserved keys `undefined`) into the `Symbol.for("vipengele:scope:tree")` slot; that is still the only non-test caller of `createScopeTree`.
- `Scope.setResource(partial)` (`scope.ts`, implemented as `setResource` in `root.ts`) is how an application supplies a Resource. It writes a new frozen attribute bag into the root node's existing `Symbol.for("vipengele:scope:attributes")` slot and never replaces the tree in the `tree` slot: a new tree would leave in-flight scopes hanging off a different root than `getScopeTree().root`.
- A key that is `undefined` or not a string is skipped, so a value can never be cleared through the API; tests restore the root by writing the saved bag back into the attributes slot.
- The logger (`logging.ts`) and the reporter's pipeline both read `Scope.resource()` per record or event, a frozen per-call snapshot, so a Resource set after a Logger or Reporter exists is the one they send.
