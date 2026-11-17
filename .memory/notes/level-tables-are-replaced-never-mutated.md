---
name: level-tables-are-replaced-never-mutated
kind: invariant
description: Published logger level tables must be replaced, never mutated, because two WeakMaps cache by table identity.
anchors:
  - path: source/core/packages/observability/src/logger/levels.ts
    blob: 1e3486904edb
  - path: source/core/packages/observability/src/logger/slots.ts
    blob: 4c510069b224
confidence: verified
---

The levels slot (`Symbol.for("vipengele.logger.levels")`, `slots.ts:5`, resolved lazily at `slots.ts:52-55`) holds a plain category to `{ level, severity }` table. Two caches key on that table's identity: `resolveEntry` memoises per table in a WeakMap (`levels.ts:70`), and `normalizeTable` caches its view per published table (`slots.ts:35`, `slots.ts:119-136`). Mutating a published table leaves both stale, so writers publish a new object: `publishLevelTable` replaces the slot with a fresh frozen copy (`slots.ts:157-161`). Published tables are frozen (`freezeTable`, `slots.ts:62-69`), so a direct write throws in strict mode rather than silently going stale.

Tables are prototype-less (`Object.create(null)`, `slots.ts:63`) and lookups use `Object.hasOwn` (`levels.ts:88`), so `constructor` and `__proto__` are ordinary category names, not inherited hits. The slot keys are dotted, unlike the colon-style key in `source/core/packages/common/src/context/global-registry.ts:31`; `slots.ts:4` cites ADR-0005 as the reason. See [[async-context-carrier-lives-in-globalthis-symbol-slot]].
