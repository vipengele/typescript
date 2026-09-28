---
about: '@vipengele/ts-core-common only exports the Level/Threshold types, not a level table; the reporter pipeline keeps its own Object.hasOwn-checked table, and the logger will need the same own-key check when it lands'
saw:
  - source/core/packages/common/src/levels/level.ts
  - source/core/packages/observability/src/errors/pipeline.ts
---

`level.ts` in common exports only the `Level`/`Threshold` string-literal union types (ADR-0007);
there is no runtime table anywhere in common that lists the six level names or lets a caller
validate an arbitrary string against them.

`source/core/packages/observability/src/errors/pipeline.ts`'s `toLevel` needs exactly that — an
unrecognised level (including a string that collides with an `Object.prototype` key, such as
`"constructor"`) has to fall back to `"error"` rather than being trusted. It does this with its
own `LEVELS` frozen object literal and an `Object.hasOwn` check, defined locally rather than
imported. When the logger's own level/threshold comparison lands, it will need the same own-key
check against the same six names; nothing today shares that table between the two consumers, so
either it gets duplicated again or common grows a `isLevel`/level table export the two can share.
