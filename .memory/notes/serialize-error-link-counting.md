---
name: serialize-error-link-counting
kind: gotcha
description: serializeError cuts at link maxLinks+1 (outermost is link 0, default 5) and replaces cut or circular errors with SerializedError-shaped markers, not omissions; the caps are per-call options, and observability keeps hand-copied defaults.
anchors:
  - path: source/core/packages/common/src/serialization/serialize-error.ts
    blob: 2759b8766095
  - path: source/core/packages/observability/src/logger/emit.ts
    blob: 07a3527a1303
  - path: source/core/packages/observability/src/errors/pipeline.ts
    blob: 6192fe976ca6
confidence: verified
---

Each step into a `cause` or `errors` entry adds one link (`serialize-error.ts:147,151`);
`serializeLink` cuts when `links > state.maxLinks` (`:166`). With the default of 5, a fixture that
hits the cut needs seven errors (outermost plus six causes). Cut and cycle are ordinary
`SerializedError` values (`type: "[Truncated]"` / `"[Circular]"`, `:48,66`), so consumers need no
null check. `errors` arrays are capped separately at `maxErrors` with a trailing `[Truncated]`
entry (`:119-125`); width is not bounded by `maxLinks`, so a wide-and-deep tree has no total node
budget. Only errors on the current path are circular (`path` Set, `:163`); the same error reached
as two siblings is serialized in full twice.

The caps are not module constants any more. `SerializeErrorOptions.maxLinks` / `maxErrors` default
to `DEFAULT_MAX_LINKS` (5) and `DEFAULT_MAX_ERRORS` (100) (`:44-45`) and live in a per-call `State`
(`createState`, `:60-69`), which also builds the truncated-chain marker so its message names the
limit that call used. `state.options` is what reaches the leaf builders and `normalizeAttributes`
(`:129,132,139`); a new bound site that skips it silently keeps the defaults. common validates
none of these values.

common exports neither default, so observability carries copies that must change with them:
`MAX_LINKS = 5` / `MAX_ERRORS = 100` in `logger/emit.ts:148-149` (bounding an error a Log
Processor returned) and `DEFAULT_MAX_BREADTH = 100` in `errors/pipeline.ts:113`. Same pattern as
[[parse-stack-copies-the-truncation-marker]].
