---
name: parse-stack-copies-the-truncation-marker
kind: gotcha
description: parse-stack.ts keeps its own copy of the "…[truncated]" marker that serializeError appends, because common does not export it; the two strings must change together.
anchors:
  - path: source/core/packages/observability/src/errors/stack/parse-stack.ts
    blob: 0471af2ff2a3
  - path: source/core/packages/common/src/serialization/engine.ts
    blob: d684c98b6650
confidence: verified
---

`engine.ts:20` defines `STRING_TRUNCATION_SUFFIX = "…[truncated]"` as a module-private constant and
appends it to any string cut at `maxStringLength` (`engine.ts:59`), a stack included.
`parse-stack.ts:9` declares `TRUNCATION_SUFFIX` with the same text and `parse-stack.ts:38` drops every
stack line ending in it, since `/app/a.js:12…[truncated]` would otherwise parse as line 12 when the
real line may be 120.

Nothing links the two constants. If the engine's marker changes, `parseStack` silently starts parsing
the truncated tail as a frame, and a test using a fixture string with the old marker would not notice.
