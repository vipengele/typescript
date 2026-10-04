---
about: stack parsing lives in observability ./errors, not common; frames are attached in the normalize stage for the top error and every cause/errors link; parseStack and markInApp stay internal
saw:
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
  - source/core/packages/observability/src/errors/stack/parse-stack.ts
  - source/core/packages/observability/src/errors/stack/in-app.ts
---
Evidence:
- ADR-0007 "One error type for both": "Stack parsing stays in the reporter"; ExceptionRecord is SerializedError plus `frames`. Considered-options rejects "Stack parsing in `common`. Every `log.error` pays for it." The logger getting no frames is deliberate.
- serialize-error.ts keeps `stack` as the raw, unparsed string and makes every nested cause/errors entry its own SerializedError, so each link carries its own stack. `frames` is derived from it and the string stays the lossless record.
- pipeline.ts `toExceptionRecord` sets `frames: markInApp(parseStack(serialized.stack), projectRoot)` and recurses into `cause` and `errors`. It runs in `normalize`, so processors (a later stage) always see frames; `enrich` stamps only id, time, level, mechanism and attributes.
- `Pipeline.projectRoot` is the only thing the pipeline learns from `ReporterBuilder.projectRoot()`. `parseStack` and `markInApp` are not exported from errors/index.ts, so the index export-set test stays unchanged.
- A throw in any pipeline stage drops the whole event, so `parseStack` and `markInApp` never throw (markInApp catches per frame and yields `{ inApp: false }`).
- event.ts `StackFrame`: `frames[0]` is the throw site (engine order); `inApp: true` means the application's own code.
