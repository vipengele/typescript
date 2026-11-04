# The Reporter owns the logger sink and both entry points share one trace reader

An error written with `log.error(message, error)` is an error the program caught and chose to log. It
should reach the Reporter's Transport without the application calling `captureException` beside every
log call. This records where that bridge lives, how the active span reaches an Error Event, and how a
Log Record maps onto an event.

## Context

The logger and the Reporter are two entry points of one package, and an application that only logs
should bundle no reporter code. The active-span reader (`readActiveTrace`) is reachable only from the
logger, while an Error Event needs the same span. The bridge from a Log Record to an Error Event needs
the `LogRecord` and `Sink` types. The ADR number `0023` is used by two files, `0023-batching-sink-wraps-a-batch-sink-and-exit-drain-is-opt-in.md`
and `0023-http-json-transport-delivery.md`; renumbering them is a separate change.

## The surface

`Reporter` gains one member, `loggerSink(options?: LoggerSinkOptions): Sink`, with
`LoggerSinkOptions { minLevel?: Level }` exported from `./errors`. It closes over the Reporter's
private pipeline. There is no public way to capture an error that is already serialized: the sink
reaches the pipeline through an internal `serialized-exception` capture kind.

The Logger gains nothing and does not depend on the Reporter. The bridge is an ordinary `Sink` the
application adds with `addSink`, so an application that only logs bundles no reporter code.

Dependency direction: `src/logger/` never imports anything from `src/errors/`, and
`src/logger/no-errors-import.node.test.ts` enforces it. `src/errors/` may import types only from
`src/logger/` (`LogRecord` and `Sink`, through `import type`), which are erased at build, so
`dist/errors/index.js` holds no logger runtime code and nothing in `errors/` value-imports `logger/`.

This is a `feat`, not a breaking change: a `Reporter` is produced by `createReporter`, and nothing
else implements it.

## Trace

- The active-span reader (`readActiveTrace`, `LogTrace` and the guards) lives in `src/trace.ts`,
  imported by both entry points. There is no shim re-exporting it from `logger/`, so `errors/` needs
  no runtime import from `logger/`.
- `ErrorEvent.trace` is typed `LogTrace`. The `enrich` stage reads the active span for every capture,
  global handlers included; with no span the event has no `trace` key.
- On the sink path the record's own `trace` wins over the live span: the record was written where the
  span was active, and the sink may run elsewhere.
- Redaction never touches `trace`: identifiers of a fixed shape are not caller data, as on the Log Record (`0021`).
- After processors and `beforeSend`, a `trace` that fails the guards is dropped and the event kept, so
  a Transport never sees a malformed id. A processor may still add, replace or strip it.

## The mapping

- **Kind.** The error is a `SerializedError` already. The `serialized-exception` kind skips
  `serializeError` but is lifted to an `ExceptionRecord` (frames, `cause`/`errors` chain) like a thrown
  value. It is bounded by the logger's serialization limits, not the Reporter's `limits(...)`, except
  that each link's frames are cut to `maxBreadth`.
- **Level.** The record's level.
- **Attributes.** The record's attributes plus `logger.category` and `logger.message`.
- **Mechanism.** `{ handled: true, source: "logger" }`.
- **Time.** The Reporter's clock.
- **Selection.** A record that carries an `error` at `minLevel` (default `"error"`) or above. A bare
  error message has nothing to report as an exception and is ignored. An invalid `minLevel` throws
  `ReporterConfigError`.
- **Stages.** Every pipeline stage applies. The event is handled, so deduplication and the rate limit
  bound it (`0020`). The logger's attributes are already redacted and the Reporter redacts again,
  which is idempotent.
- **Re-entrancy.** A write that arrives while the same sink's own capture is on the stack is dropped,
  so a Transport that logs back through the same logger cannot loop.
- **Close.** After `close()` the sink behaves exactly like `captureException`. Delivery is the
  Transport's concern (`0010`), and the Reporter keeps no closed flag.

## Considered options

- **The Logger depending on the Reporter.** The logger would pull the reporter into every bundle that
  only logs, and `logger/` would import `errors/`.
- **A public `captureSerialized` API.** It would commit a second capture contract with its own limits
  and trace rules for one internal caller. A member that closes over the pipeline exposes nothing else.
- **A Reporter-level closed flag.** It would make the sink and `captureException` disagree with the
  Transport about what `close()` means; delivery after close is already the Transport's decision.
- **Trace-less events.** Leaving `trace` to the logger side only would make an Error Event and the Log
  Record for the same failure impossible to join on the span.

## Consequences

- A logged error and a captured one reach the Transport as the same `ErrorEvent` shape, told apart by
  `mechanism.source`.
- An error logged and also passed to `captureException` is two events; deduplication compares only
  with the last event that passed and may fold them.
- The sink's depth guard is synchronous. A Transport that logs back from a later tick is not caught
  by it and relies on dedupe and the rate limit.
