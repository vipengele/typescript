---
about: ReporterBuilder.limits validates at the call because common's engine does not, and the frames cap deliberately appends no marker entry, unlike every other cut container
saw:
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter-config-error.ts
---
- `serializeError` and `normalizeAttributes` do not validate their options, so `NaN` or a non-positive limit would reach the engine; `builder.ts` rejects anything but a positive integer or `Infinity` at the `.limits()` call and validates every key before mutating, so a rejected call leaves the builder unchanged.
- A cut string is the limit plus the `…[truncated]` suffix and a cut container holds the limit plus one marker entry, so no limit is an exact ceiling. `boundFrames` in `pipeline.ts` is the exception: it keeps exactly `maxBreadth` frames, throw site first, with no marker, because a marker entry would read as one more frame to a consumer.
- `ReporterConfigError` (code `observability.errors.config`) follows ADR-0002 and matches by `code` in `isReporterConfigError`, never `instanceof` its own class.
