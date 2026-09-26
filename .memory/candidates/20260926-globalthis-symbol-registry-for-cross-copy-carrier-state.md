---
about: createAsyncContextStore's carrier lives in a globalThis slot keyed by Symbol.for(key), not a module-level variable, so two dual-resolved copies of @vipengele/ts-core-common sharing a key see the same context and the same useCarrier override
saw:
  - source/core/packages/common/src/context/global-registry.ts
  - source/core/packages/common/src/context/async-context-store.ts
  - source/core/packages/common/src/context/capabilities.ts
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
---

Built while implementing issue #15 (async context store, slice 1). `getOrCreateRegistryEntry`
(`global-registry.ts:30`) keys a `globalThis` slot with `Symbol.for(\`vipengele:async-context-store:${key}\`)`
and stores the resolved `ContextCarrier<T>` object itself in that slot, not a factory or thunk.
`createAsyncContextStore` (`async-context-store.ts:60`) is the only caller: it passes
`() => resolveDefaultCarrier(defaultValue)` as `createDefault`, so the first store constructed
for a given key picks the carrier (and its default value) — a later `createAsyncContextStore`
call with the same key gets a handle on the existing slot, and its own `defaultValue` argument is
silently ignored. `useCarrier` on any handle calls `entry.set`, replacing the slot's carrier for
every other handle on that key immediately, in every module instance in the realm.

This is deliberate, not an oversight worth "fixing" toward a plain module-level `let carrier`:
ADR-0006 calls out that two resolved copies of the package (differing peer ranges are enough)
each get their own module scope, so a module-level variable would give each copy an invisible
private context, defeating the entire point of a cross-cutting context primitive. `Symbol.for`
(as opposed to a plain string property) means the *key itself* is shared across realm copies too,
so a collision with an unrelated `globalThis` property can't happen by coincidence.

Any future `@vipengele/*` state that must be one shared value across every resolved copy of a
package (not just within one module instance) should reach for this same shape — a
`Symbol.for`-keyed `globalThis` slot, first-caller-wins default, explicit setter for override —
rather than inventing a new sharing mechanism per feature.
