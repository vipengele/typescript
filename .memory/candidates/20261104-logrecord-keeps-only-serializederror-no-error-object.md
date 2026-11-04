---
about: "a LogRecord carries only a redacted SerializedError, never the original Error, so a logger sink cannot call captureException with the real Error; no recursion guard exists between a reporter-as-sink and its own logging"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
  - source/core/packages/observability/src/logger/logging.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
Found while scoping issue #47.

- `LogRecord.error?: SerializedError` (`logger/record.ts`), already redacted (ADR-0007) and frozen; processors may even rebuild it (ADR-0017). The original `Error` is gone by the time a `Sink.write(record, resource)` runs (`Sink` is sync, no flush/close; throws go to `onSinkError`, warned once per sink on the default path, `logging.ts:75`).
- `Reporter.captureException(error: unknown, {attributes?, level?})` (`errors/reporter.ts`) runs `serializeError(input.error)` in `normalize` (`pipeline.ts`). `serializeNode` (common `serialize-error.ts:127`) treats any non-`Error` as `synthetic: true` with the JSON-safe form as message, so passing a SerializedError would yield a synthetic wrapper, not the chain. A sink bridge needs a new pipeline input kind (pre-serialized exception, skip `serializeError`, still `toExceptionRecord` for frames from `stack`) or a reconstructed Error.
- `Mechanism.source` already includes `"logger"` (`errors/event.ts:43`), unused anywhere in src; `handled` for a logged error is a choice (true is the natural one).
- Recursion: nothing guards it. The reporter itself never logs (no `Logging` use in `src/errors`); the console transport writes to `console`, not the logger. The only loop is user wiring (a transport or processor that logs through a logger whose sink is the reporter). Dedupe and the rate limit (on by default, ADR-0020) bound it for handled events, but unhandled (`handled:false`) bypass both.
- Dependency direction: no lint rule, test or export restriction stops `src/errors` importing `src/logger`, or the reverse. `otlp/encode-error-events.ts` already imports `errors/event` types and `otlp/encode-logs.ts` imports `logger/record`; `logger/` imports nothing from `errors/` (grep). The rule is convention only.
