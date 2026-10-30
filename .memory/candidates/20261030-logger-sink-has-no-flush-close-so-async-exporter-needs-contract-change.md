---
about: "logger Sink is write-only and sync-fire-and-forget; Logging/LoggerProvider have no flush/shutdown, so an async batching exporter has no lifecycle hook (ADR-0017 defers it)"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/index.ts
  - source/core/packages/observability/tsup.config.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
---
Found while planning issue #33. `grep -n "flush|shutdown|close" logger/{logging,provider,builder}.ts` -> 0 hits.

- `Sink = { write(record, resource): void }` (`record.ts:43-45`); returned promise not awaited, sync throw -> `onSinkError(error, sink)` and other sinks still run. ADR-0017 "Consequences" says Sink `flush`/`close` are not part of that decision. A batching exporter sink therefore must expose its own `flush/close` on the returned object (like `TestSink` adds `find/clear`) and the app must call them itself; nothing on `Logging` calls them on reset/reconfigure, so a replaced provider leaks a live batch timer.
- Adding optional `flush?/close?` to `Sink` is additive for type but the `(record, resource)` arity is part of the `vipengele.logger.provider.v1` slot protocol (ADR-0005); a new provider method shared across copies would need the slot version considered. Export surface is pinned by `logger/index.test.ts` (exact `Object.keys` sort), and the only tsup entries are `src/logger/index.ts` and `src/errors/index.ts`; the new export goes in logger/index.ts and that test.
- `./logger` and `./errors` do not import each other (console-sink keeps its own level routing copy), so sharing reporter machinery means a third shared module inside the package or in common/resilience, not an import across entry points.
