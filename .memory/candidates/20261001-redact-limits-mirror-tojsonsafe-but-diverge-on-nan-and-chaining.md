---
about: redact()'s depth/breadth/string limits copy toJsonSafe's names, defaults and markers, but differ on NaN breadth and on being chained with toJsonSafe; the constants are duplicated because redaction is dependency-free
saw:
  - source/core/packages/redaction/src/limits.ts
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/README.md
  - source/core/packages/common/src/serialization/engine.ts
  - docs/release-notes/v0.0.2.md
---

- `limits.ts` repeats toJsonSafe's defaults (maxDepth 6, maxBreadth 100, maxStringLength 8192) and
  markers (`"[Truncated]"`, `"[Truncated: N more]"`, `"…[truncated]"`, key `"…"`) instead of
  importing them from `@vipengele/ts-core-common`, because the redaction package has no runtime
  dependencies. `limits.test.ts` pins the literals, so a drift in `engine.ts` is not caught by
  anything but a human comparing the two.
- The walk in `redact.ts` carries a depth counter (root = 1) through `WalkContext`. The cycle check
  runs before the depth check, so a back-reference at the depth limit reads `"[Circular]"`.
  `redactField` matches a key before walking its value, so a matched key past the depth limit is
  still replaced, while a container past the limit is never read.
- Map and Set are iterated directly and stop at `maxBreadth`; the marker count comes from `.size`.
  Spreading them into an array first makes a huge collection cost O(size) despite the limit.
- `NaN` disables a limit in redact (the checks are `>` comparisons, and arrays are only sliced once
  the limit is exceeded). In `toJsonSafe`, `slice(0, NaN)` empties a container, so the two differ.
- `redact` then `toJsonSafe` with equal breadth defaults miscounts: the second step treats the first
  step's `"[Truncated: N more]"` marker as an entry. The README tells callers to bound in one step
  and pass `Infinity` in the other.
- `docs/release-notes/v0.0.2.md` claims redact honoured limits before this existed; it is published
  history and stays as is. Release notes for the release that ships limits must flag the changed
  default output as breaking.
