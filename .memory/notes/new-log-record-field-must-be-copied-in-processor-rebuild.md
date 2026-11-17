---
name: new-log-record-field-must-be-copied-in-processor-rebuild
kind: gotcha
description: emit.ts rebuilds every record a Log Processor returns from the known LogRecord fields, so a new top-level field is silently dropped unless acceptProcessorOutput and acceptNormalized both copy it.
anchors:
  - path: source/core/packages/observability/src/logger/emit.ts
    blob: 07a3527a1303
  - path: source/core/packages/observability/src/logger/record.ts
    blob: b944139ea8d9
confidence: verified
---

In `source/core/packages/observability/src/logger/emit.ts`, `acceptProcessorOutput` (`:274`)
builds a fresh record from time, level, category, message, attributes and, when present, `error`
and `trace` (`:306-307`); `acceptNormalized` (`:317`) does the same by reference (`:328-329`).
Extra keys vanish by design. The built-in redaction stage is itself a processor, so every record
passes through here.

A field added to `LogRecord` and not copied in both functions is lost on every record, with no
error and no failing type. `trace` shows the pattern: validated by `acceptTrace` (`:244-252`),
which throws on a malformed value, dropping the record for that processor's sinks.
