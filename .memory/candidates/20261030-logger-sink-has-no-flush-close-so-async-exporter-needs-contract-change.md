---
about: "logger Sink is write-only; Logging/LoggerProvider have no flush/shutdown, so an exporter sink carries its own flush/close (OtlpLogSink) and nothing calls them on reconfigure"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/otlp-sink.ts
  - source/core/packages/observability/src/logger/index.test.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
  - docs/adr/0022-otlp-export-shares-one-delivery-core.md
---
- `Sink = { write(record, resource): void }` (`record.ts`); a sync throw goes to `onSinkError` and
  other sinks still run. `grep -n "flush|shutdown|close" logger/{logging,provider}.ts` finds nothing.
- An exporter therefore exposes lifecycle on the object it returns: `OtlpLogSink = Sink & { flush,
  close }` (`otlp-sink.ts`, ADR-0022), the way `TestSink` adds `find/clear`. The host must hold the
  sink and call `close()` itself; `Logging.configure`/reset never calls it, so a provider replaced
  while an OTLP sink is live leaves its batch timer and unload listeners running until `close()`.
- Adding `flush/close` to `Sink` or the provider would touch the `vipengele.logger.provider.v1`
  slot protocol (ADR-0005); ADR-0022 rejects it for that reason.
- The `./logger` runtime export list is pinned by `logger/index.test.ts` (exact sorted keys).
