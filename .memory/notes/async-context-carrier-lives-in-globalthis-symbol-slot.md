---
name: async-context-carrier-lives-in-globalthis-symbol-slot
kind: rationale
description: The async context carrier is stored in a Symbol.for-keyed globalThis slot, first caller wins, so dual-resolved copies of common share one context.
anchors:
  - path: source/core/packages/common/src/context/global-registry.ts
    blob: 2e54d0a8547a
  - path: source/core/packages/common/src/context/async-context-store.ts
    blob: 052098adb727
confidence: verified
---

`getOrCreateRegistryEntry` (`global-registry.ts:30`) keys a `globalThis` slot with
`Symbol.for("vipengele:async-context-store:<key>")` and stores the carrier itself. The first
`createAsyncContextStore` (`async-context-store.ts:61`) for a key picks the carrier and default; a
later call's `defaultValue` is silently ignored, and `useCarrier` replaces the carrier for every
handle on that key. This is deliberate, not a candidate for a module-level `let`: ADR-0006 notes two
resolved copies of the package (differing peer ranges suffice) each get their own module scope, so
a module variable would give each an invisible private context. Reuse this shape only for state
that must be one value across all copies; a per-instance dependency such as the reporter clock is
injected via its builder instead.
