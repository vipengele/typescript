---
about: "A LogRecord carries only a redacted SerializedError, never the original Error, so reporter.loggerSink captures through the internal serialized-exception kind rather than captureException; its recursion guard is synchronous only"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/errors/logger-sink.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/dedupe.ts
  - source/core/packages/observability/src/logger/no-errors-import.node.test.ts
  - docs/adr/0026-reporter-owned-logger-sink.md
---
- `LogRecord.error?: SerializedError` (`logger/record.ts`) is already redacted and frozen; the original `Error` is gone when a `Sink.write` runs. Passing it to `captureException` would make `serializeError` treat it as a non-Error and wrap it as a synthetic message, so `createLoggerSink` (`errors/logger-sink.ts`) captures `{ kind: "serialized-exception", ... }` with mechanism `{ handled: true, source: "logger" }`.
- In `normalize` (`errors/pipeline.ts`) that kind skips `serializeError` and lifts it through `toExceptionRecord(..., detach: true)`, which deep-copies each link's `data` (every other link field is primitive or rebuilt, so `data` is the only object a frozen caller-owned error would otherwise share with processors) to an `ExceptionRecord` like a thrown value. The reporter's `limits(...)` therefore bound only its frames (`maxBreadth`); depth, string length and link counts are the logger's.
- The sink's re-entrancy flag is a plain boolean set around the synchronous `capture`, so it stops a transport or processor that logs back through the same logger on the same stack from being reported; that write is still recorded as a breadcrumb unless the sink was built with `{ breadcrumbs: false }` (ADR-0027). A log made from a later tick is not caught; dedupe and the rate limit bound it only because the event is `handled` (unhandled events bypass both, ADR-0020).
- `dedupe.ts`'s `signatureOf` ignores `mechanism`, so an error both logged and passed to `captureException` can be folded into one event when the two arrive back to back.
- Direction: `logger/` must not import `errors/` (`no-errors-import.node.test.ts` scans every `src/logger/**/*.ts` and resolves each relative specifier); shipped `errors/` source imports only types from `logger/` (`import type { LogRecord, Sink }`), so `dist/errors/index.js` carries no logger runtime code (tests in `errors/` may value-import it).
