---
name: redact-limits-duplicate-tojsonsafe-and-diverge-on-nan
kind: gotcha
description: redact()'s limit defaults and markers are copied from toJsonSafe with nothing checking drift, and the two differ on NaN limits and when chained at default breadth.
anchors:
  - path: source/core/packages/redaction/src/limits.ts
    blob: 5dc77b989134
  - path: source/core/packages/common/src/serialization/engine.ts
    blob: d684c98b6650
  - path: source/core/packages/redaction/README.md
    blob: 0b81b48979e7
confidence: verified
---

- `limits.ts:1-17` repeats toJsonSafe's defaults (6 / 100 / 8192) and markers (`"[Truncated]"`,
  `"[Truncated: N more]"`, `"…[truncated]"`, key `"…"`) from `engine.ts:12-17` instead of importing
  them, because the redaction package has no runtime dependencies. `limits.test.ts:20-23` pins the
  redaction literals only, so drift in `engine.ts` is caught by nothing but a human comparing them.
- `NaN` disables a limit in redact: every check is a `>` comparison (`limits.ts:56-58`) and arrays
  are sliced only once the limit is exceeded (`limits.ts:74-76`). In `toJsonSafe`,
  `keys.slice(0, state.maxBreadth)` (`engine.ts:95`) with `NaN` empties the container.
- `redact` then `toJsonSafe` at default breadth miscounts: the second step treats the first step's
  `"[Truncated: N more]"` marker as an entry. `README.md:214-220` says to bound in one step and pass
  `Infinity` in the other.
- `docs/release-notes/v0.0.2.md:26` already says redact honours limits; it is published history and
  stays as is.
