---
about: stack parsing is ADR-decided to live in observability ./errors, not common; the pipeline already has a frames:[] placeholder and a StackFrame type with inApp
saw:
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
---
Evidence (issue #39 planning):
- ADR-0007 "One error type for both" (l.119-125): "Stack parsing stays in the reporter"; ExceptionRecord adds `frames` and is a structural superset of SerializedError. Considered-options l.162 rejects "Stack parsing in `common`. Every `log.error` pays for it." So the logger NOT getting frames is deliberate.
- serialize-error.ts:16 keeps `stack` as "The raw stack, unparsed"; every nested cause/errors entry is its own SerializedError via makeErrorLeaf (serialize-error.ts:97), so each carries its own stack.
- pipeline.ts:44-55 `toExceptionRecord` already recurses cause/errors and gives each link `frames: []` (placeholder). Parsing slots in there per link. Stage "[Truncated]"/"[Circular]" markers have no stack, so they get no real frames.
- event.ts:44-51 StackFrame already exists: `function? file? line? column? inApp?` (camelCase inApp, no order decided). Exported from errors/index.ts:3.
- Stage split: pipeline.ts:57 normalize = caller's payload in Event shape (the one place frames can be produced from the thrown value's own stack); enrich (l.62) stamps id/time/level/mechanism/attributes only. Processors (stage 3) run after both, so a processor sees frames only if they are produced in normalize/enrich. Putting in-app marking in enrich needs the projectRoot from `Pipeline` (pipeline.ts:29-34, no such field today).
- builder.ts has no processors/filters setter yet (grep processor|filter -> 0 hits), though Pipeline carries both.
- Consequence for in-app: ADR-0007 says SerializedError `stack` stays raw, so frames are computed from it; redact() also copies `stack` by hand (see note redact-walks-error-fields-explicitly), so redaction of frames/paths is a separate concern to check.
