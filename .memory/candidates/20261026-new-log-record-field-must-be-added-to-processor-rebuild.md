---
about: "emit.ts rebuilds a processor's returned record from the known LogRecord fields only, so a new top-level LogRecord field is silently dropped unless acceptProcessorOutput and acceptNormalized both copy it, as they do for trace"
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/record.ts
---
`acceptProcessorOutput` builds the record from time, level, category, message, attributes, and optionally `error` and `trace`; `acceptNormalized` does the same by reference for a record `markNormalized` marked. A field added to `LogRecord` and not copied in both is lost on every record that passes a processor, `redactionProcessor` included, with no error. `trace` is validated by `acceptTrace` (hex ids, integer flags) and rebuilt fresh, reusing `previous.trace` when the processor returned it unchanged; a malformed one throws `TypeError` and the record is dropped for that processor's sinks. `createRecord` reads the registry only after the level and sink early-returns, inside the guard in `emitRecord`, so a throw drops the record silently. Redaction covers attributes and the error chain only, so a top-level `trace` is never redacted.
