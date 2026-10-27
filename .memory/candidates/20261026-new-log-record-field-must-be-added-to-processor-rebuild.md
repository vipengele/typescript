---
about: "emit.ts rebuilds a processor's returned record from the known LogRecord fields only, so a new top-level field such as trace is silently dropped unless acceptProcessorOutput and acceptNormalized copy it"
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/record.ts
---
`emit.ts` `acceptProcessorOutput` (~line 255) builds `record` with only time, level, category, message, attributes (+ error); `acceptNormalized` (~line 285) does the same. Any other key a processor set, or a field the built record carried (e.g. a new `trace`), is left out, so every record that passes a processor (including `redactionProcessor`) would lose it. The doc comment on `emitRecord` states "rebuilt from the LogRecord fields alone". Also `createRecord` runs inside one try/catch in `emitRecord` (a throw drops the record silently), and nothing is async between the call and createRecord, so a span read there is synchronous. Redaction (`redaction.ts`) runs over attributes and error only; a top-level `trace` would not be redacted by `secretKeys`, whereas a `trace_id` attribute key would be subject to key matching. Line numbers are approximate (not re-verified past reading).
