---
about: foreign-level-entries note re-checked while reading the logger for issue #27; claims hold
saw:
  - source/core/packages/observability/src/logger/slots.ts
  - source/core/packages/observability/src/logger/logging.ts
targets: foreign-level-entries-resolve-up-to-nearest-known-level
verdict: still-true
---
`normalizeEntry` and `FALLBACK_LEVEL = "warn"` are both in `slots.ts`: the pointers hold. `setWarnTarget` state is per-copy module state: `let warnTarget` is declared at module level in `logging.ts` and read at report time. The severity-placement body of `normalizeEntry` was not re-read in this task.
