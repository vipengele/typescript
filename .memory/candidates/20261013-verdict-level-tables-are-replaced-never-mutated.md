---
about: level-tables-are-replaced-never-mutated re-checked while reading the logger for configuration sources; claims hold in substance
saw:
  - source/core/packages/observability/src/logger/levels.ts
  - source/core/packages/observability/src/logger/slots.ts
targets: level-tables-are-replaced-never-mutated
verdict: still-true
---
Replace-never-mutate holds: `publishLevelTable` (slots.ts:154-158) assigns a fresh frozen copy; `resolutions` WeakMap keyed by table identity is levels.ts:70; `views` WeakMap is slots.ts:32 (note said :28); prototype-less table and `Object.hasOwn` are slots.ts:60/levels.ts:88 (note said slots.ts:56 and levels.ts:88). Line numbers in the body have drifted by a few lines in slots.ts; claims are unchanged. Tables are also frozen, so a direct mutation throws in strict mode rather than silently going stale.
