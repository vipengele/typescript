---
about: source/core/packages/common/src/scope/store.ts
saw: |
  A panel-code-review pass flagged getScopeStore() rebuilding its AsyncContextStore handle on
  every call as a hot-path allocation (Scope.current() is read on every log record and error
  event). Fixed by memoizing the handle in a module-level `let`, then verified with a review
  pass that memoizing does not break cross-copy sharing.
---

`createAsyncContextStore(key, defaultValue)` (in `source/core/packages/common/src/context/`)
is safe to memoize per call site: the returned handle's `current`/`propagate`/`useCarrier` all
re-read the carrier from a `globalThis` slot keyed by `Symbol.for` on every call (see
`getOrCreateRegistryEntry` in `context/global-registry.ts`), so a cached handle still observes a
carrier installed later through any other handle — including one built by a second resolved copy
of the package.

This means any `@vipengele/*` module that calls `createAsyncContextStore` on a hot path (read on
every log record, every request) can and should memoize the returned handle at module level
instead of calling `createAsyncContextStore` fresh each time — the function itself does non-trivial
work (a `Symbol.for` template-string lookup, a registry entry, a fresh store object), none of
which the memoized handle's own registry-backed methods actually need repeated.
