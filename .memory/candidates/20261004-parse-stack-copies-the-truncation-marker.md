---
about: parse-stack.ts keeps its own copy of the "…[truncated]" marker serializeError appends, because common does not export it; the two strings must change together
saw:
  - source/core/packages/observability/src/errors/stack/parse-stack.ts
  - source/core/packages/common/src/serialization/engine.ts
---
Evidence:
- engine.ts defines `STRING_TRUNCATION_SUFFIX = "…[truncated]"` as a module-private constant and appends it to any string longer than `maxStringLength`, a stack included.
- parse-stack.ts declares `TRUNCATION_SUFFIX` with the same text and drops every stack line ending in it. A truncated line such as `/app/a.js:12…[truncated]` would otherwise parse as line 12 of a file when the real line may be 120.
- Nothing links the two constants. If the engine's marker changes, parse-stack.ts silently starts parsing the truncated tail as a frame; its tests use a fixture string with the marker, so they do not notice either.
