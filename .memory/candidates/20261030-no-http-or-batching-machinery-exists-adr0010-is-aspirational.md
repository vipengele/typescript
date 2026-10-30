---
about: "no batching/retry/HTTP/OTLP code exists in observability; ADR-0010 and ADR-0007/0008 describe an HTTP JSON Transport and an OTLP mapping that are not built, and Transport is typed to ErrorEvent"
saw:
  - source/core/packages/observability/src/errors/transport.ts
  - source/core/packages/observability/src/errors/transports/
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/resilience/src/retry/retry.ts
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0008-opentelemetry-is-an-opt-in-entry-point.md
  - CONTEXT.md
  - .lydite/components.yml
---
Found while planning issue #33 (OTLP log exporter). Found by grep, then reading.

- `grep -rniE "fetch|sendBeacon|backoff|retry|batch|indexeddb" observability/src` hits only comments/doc text (transport.ts, runtime-context.ts) and tests; no queue, batcher, HTTP or OTLP code. `errors/transports/` holds only console and test transports. `Transport.send(event: ErrorEvent, resource)` is typed to ErrorEvent (`errors/transport.ts`), so nothing generic exists to share.
- ADR-0010 specifies an "HTTP JSON Transport" (batch, retry, IndexedDB offline queue, pagehide/visibilitychange keepalive-fetch or sendBeacon, 64 KiB keepalive limit, queue keeps oldest and drops newest) and says batching is the Transport's, not a wrapper's; none is implemented. ADR-0008 calls "the OTLP Transport" the framework's own export, mutually exclusive with `OtelLogging.bridge()` (builder warns once on both); neither `bridge` nor an `@vipengele/ts/otel` entry exists.
- ADR-0007 "Mapping onto OpenTelemetry" is the only recorded OTLP mapping (severityNumber 1/5/9/13/17/21, time*1e6 to timeUnixNano, category -> InstrumentationScope.name, trace -> traceId/spanId/flags, Scope root -> ResourceLogs.resource once per payload, exception.* attrs with Caused-by stacktrace). LogRecord.time is a float ms number, so nano conversion must avoid bigint-unsafe JSON (send as string).
- `@vipengele/ts-core-resilience` (`retry/`: createRetry, exponentialBackoff, withJitter; `timeout/`) exists and is the natural retry/backoff source, but observability does not depend on it (package.json dependencies: common, redaction only) and both are `workspace:*` intra-project links; resilience is a separate lydite component.
- CONTEXT.md Transport entry already says Transport delivers "Error Events (and exported Log Records)" and "Avoid: exporter ... use it only for OTLP specifically"; Sink entry lists "an exporter" as a Sink. So glossary wording supports either.
