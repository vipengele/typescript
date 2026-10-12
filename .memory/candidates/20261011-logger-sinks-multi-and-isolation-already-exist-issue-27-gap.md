---
about: the logger's sink path as it stands: several sinks, per-sink isolation, global and per-sink Log Processors that fail closed, and failures reported to onSinkError(error, source), deduplicated only on the default warn path
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/builder.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/slots.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
---
- `addSink(sink, { processors })` and `addProcessor(p)` (`builder.ts`) record their arguments when called and validate only in `build()`, which throws `LoggingConfigError`; `OutputSettings.sinks` holds `SinkRegistration` (`{ sink, processors }`) and `processors` holds the global chain (`record.ts`, `settings.ts`). `Sink` is still `{ write(record, resource) }` with no flush or close, and the `(record, resource)` arity is part of the `provider.v1` protocol.
- `emitRecord` (`emit.ts`) builds and redacts the record, runs the global processors, then for each sink its own processors and its `write`, each in its own guard. Built-in redaction is always the first stage; `redaction(null)` only disables it. A processor that throws or returns a malformed record yields `null`: the record is dropped for every sink (global) or for that sink (per-sink), and the failure goes to `onSinkError(error, processor)`. A throw while building the record or reading the Resource still drops the record silently and is not reported.
- A processor's returned record is rebuilt from the `LogRecord` fields only (`acceptProcessorOutput`), so extra keys vanish and the processor's own objects are never frozen. `acceptErrorLink` bounds a returned error with `MAX_LINKS = 5` and `MAX_ERRORS = 100`, copies of `serializeError`'s defaults because common does not export them; if common's defaults change those two constants must change with them. `type` and `code` are cut here although `serializeError` leaves them alone.
- `EmitSettings.onSinkError(error, source)` receives every failure with the failing `Sink` or `LogProcessor` and has no dedup. Dedup is the provider's: `LoggerProviderOptions.sinkErrorsOncePerSource` wraps the host callback in an identity `WeakSet` held in the provider closure (`provider.ts`). A successful `configure` and `reset` replace the set, `override` and a rejected `configure` do not. `logging.ts` sets the option for the default provider and for `Logging.createProvider`, whose warn text names a sink or a processor by checking `typeof source === "function"`; a bare `createLoggerProvider` without `onSinkError` drops failures silently.
- A copy that finds another `vipengele.logger.provider.<non-v1>` symbol on `globalThis` warns once, the first time its default provider is resolved (`findForeignProviderProtocols` in `slots.ts`, flag `protocolsChecked` in `logging.ts`). A copy that loads after another copy's first resolution goes unreported.
- The reporter's `Processor` and `Filter` (`errors/pipeline.ts`) are unrelated to the logger's `LogProcessor`; `createReporter` still hard-codes `processors: []` and `filters: []`.
