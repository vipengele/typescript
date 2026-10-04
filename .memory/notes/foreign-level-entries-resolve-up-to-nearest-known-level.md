---
name: foreign-level-entries-resolve-up-to-nearest-known-level
kind: rationale
description: A level entry this copy cannot name resolves by severity to the nearest known level at or above it, and malformed entries fall back to warn, never to everything on.
anchors:
  - path: source/core/packages/observability/src/logger/slots.ts
    blob: a8d15b09ebfe
  - path: source/core/packages/observability/src/logger/logging.ts
    blob: cf1e088be55b
  - path: source/core/packages/observability/src/logger/logging.test.ts
    blob: eaf6d9981aa4
confidence: verified
---

Another package version may write a level name this copy does not know. `normalizeEntry` (`slots.ts:84-97`) trusts a known name, otherwise places the carried `severity` at the first known level whose severity is >= it (`slots.ts:95`), so this copy never enables a record the foreign entry excludes; above `fatal` gives `off`. A malformed entry becomes `warn` (`FALLBACK_LEVEL`, `slots.ts:18`), chosen over `off` so garbage cannot hide `error`/`fatal`.

`setWarnTarget` is per-copy module state (`logging.ts:17`): a configure through another copy's default provider reports through that copy's target. `logging.test.ts:65` simulates a second copy by wiring a provider like the default one outside the provider slot.
