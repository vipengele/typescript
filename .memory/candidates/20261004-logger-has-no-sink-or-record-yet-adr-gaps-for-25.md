---
about: the #24 logger has no Sink, Log Record or emit method at all, so #25 defines the sink contract fresh; ADR-0007 fixes the record shape but leaves several #25 questions open
saw:
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/logger/index.ts
  - source/core/packages/observability/README.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/common/src/serialization/serialize-error.ts
  - source/core/packages/common/src/attributes/normalize-attributes.ts
  - source/core/packages/common/src/time/clock.ts
---

Verified by reading; no stale note was involved.

- `Logger` is only `{ category, enabled(level) }` (`logger.ts:14-20`). `grep -rniE 'sink|LogRecord'`
  over `source/` finds no Sink or LogRecord type; README.md:51-54 says records and emit methods
  arrive with #25 and sinks with #27. There is no existing sink signature to break.
- ADR-0007 (`0007-...md:30-38`) fixes `LogRecord {time: number epoch ms with fraction from an
  injectable clock, level, category, message: string, attributes: Attributes, error?:
  SerializedError, trace?}`. `Clock`/`systemClock` already exist in common (`time/clock.ts`).
- ADR-0007 :106-117: attributes normalized once, only if the level is enabled; redaction "at the
  same point, before any Sink". :121-125: `log.error(message, error)` and `captureException` share
  one `serializeError` tree; chain limit 5 links, cycle-safe.
- `serializeError(value)` takes no options and does not redact; non-Error gives `synthetic: true`
  (`serialize-error.ts`, `serializeNode`). `normalizeAttributes` has depth/breadth/string options,
  so ADR-0007's "builder-configurable limits" cannot reach error `data` without a common change.
- ADR-0007 :127-132: Resource is not copied into records; Sinks receive it alongside each record.
  ADR-0006 :32-38: merge order is Scope chain, Logger bindings, call attributes. Scope merge and
  `logger.with` belong to #26. The Scope root is UNKNOWN_RESOURCE with nothing supplying a real one
  (see note scope-root-defaults-to-unknown-resource).
- Not decided in ADRs/CONTEXT/README: which levels take an error beyond the ADR's `log.error`
  example, non-Error handling at the call site, error redaction.
- ADR-0005 :50-52: sinks are keyed by record-protocol version `vipengele.logger.provider.v1`, bumped
  when the Log Record shape breaks, so #25's record shape is a protocol commitment.
