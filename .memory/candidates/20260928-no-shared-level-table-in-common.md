---
about: '@vipengele/ts-core-common owns the runtime level table (SEVERITY_NUMBERS) and the isLevel own-key guard; consumers validate an arbitrary string with isLevel instead of keeping a private table'
saw:
  - source/core/packages/common/src/levels/severity.ts
  - source/core/packages/observability/src/errors/pipeline.ts
---

`severity.ts` in common exports `SEVERITY_NUMBERS` (a frozen table of the six `Level`s to their
OpenTelemetry severity numbers) and `isLevel(value: unknown): value is Level`, which is
`typeof value === "string" && Object.hasOwn(SEVERITY_NUMBERS, value)`. The own-key check is what
rejects a string that collides with an `Object.prototype` key such as `"constructor"`, and the
`"off"` threshold.

`source/core/packages/observability/src/errors/pipeline.ts`'s `toLevel` calls `isLevel` and falls
back to `"error"` for anything else. A logger comparing levels against a `Threshold` validates a
string the same way, through `isLevel`, rather than defining a second table.
