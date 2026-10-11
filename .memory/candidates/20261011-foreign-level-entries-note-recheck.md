---
about: foreign-level-entries note re-checked while reading the logger for issue #27; claims hold, one line number drifted
saw:
  - source/core/packages/observability/src/logger/slots.ts
  - source/core/packages/observability/src/logger/logging.ts
targets: foreign-level-entries-resolve-up-to-nearest-known-level
verdict: still-true
---
`normalizeEntry` is at `slots.ts:84`, `FALLBACK_LEVEL = "warn"` at `slots.ts:18`: both pointers hold. `setWarnTarget` state is per-copy module state: `let warnTarget` is at `logging.ts:18` (note says `:17`), declared module-level and read at report time (`logging.ts:11-17`). The severity-placement body (`slots.ts:95`) was not re-read in this task.
