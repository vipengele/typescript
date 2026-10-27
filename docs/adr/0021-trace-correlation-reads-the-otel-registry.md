# Trace correlation reads OpenTelemetry's global registry

This amends one decision of `0008-opentelemetry-is-an-opt-in-entry-point.md`: how the active span is
found. Its other decisions stand — baggage is copied only by allowlist, an application bridges or
exports but never both, exceptions are exported as log records, and the Scope and OpenTelemetry's
`Context` are independent.

A `LogRecord` carries the active span in its top-level `trace` field whenever OpenTelemetry has one,
with no import and no configuration. `@vipengele/ts-core-observability/logger` finds it by reading
the registry `@opentelemetry/api` writes for itself:

1. `globalThis[Symbol.for('opentelemetry.js.api.1')]`, the API's global registration.
2. Its `.context`, the registered `ContextManager`.
3. `.active().getValue(Symbol.for('OpenTelemetry Context Key SPAN'))`, the active span.
4. `.spanContext()`, for `traceId`, `spanId` and `traceFlags`.

`traceFlags` is stored as `flags`, giving the `{ traceId, spanId, flags }` shape
`0007-the-log-record-and-error-event-data-model.md` defines. A record with no registry, no context
manager, no active span or no valid ids has no `trace` field at all.

## How the read behaves

- **Synchronous.** It runs while the record is created, after the level check and the no-sink early
  return, so a record that is never written never touches the registry.
- **Never fatal.** The whole read sits in a `try`/`catch`. A missing step or a throw anywhere in it
  gives no `trace`; the record is still written, and nothing goes to `onSinkError`.
- **Valid ids only.** A trace id of 32 hex characters and a span id of 16, neither all
  zeros. OpenTelemetry's no-op tracer hands out all-zero ids, and a record correlated to them is
  correlated to nothing.
- **Not redacted.** `trace` is a top-level field, not an attribute, so the record's redaction, which
  covers attributes and the error chain, never sees it. Its values are identifiers with a fixed
  shape, not caller data.

Nothing in shipped `src/` imports `@opentelemetry/api`. The package declares it as an optional peer,
`^1.9`, marked optional in `peerDependenciesMeta`; the range documents which API versions the
registry layout is tested against, not a module the package loads. An application without
OpenTelemetry has no registry slot, so every record simply has no `trace`, and its bundler never
resolves the peer.

## Why the silent-breakage objection no longer holds

ADR-0008 rejected reading the registry because its key and the span key are implementation details
of `@opentelemetry/api`, and a change to either would switch correlation off silently,
indistinguishable from a request that had no span. That objection is about detection going
unnoticed, and a test answers it.

`trace.contract.test.ts` runs against the real `@opentelemetry/api`, a devDependency. It registers a
context manager through `context.setGlobalContextManager`, makes a span with
`trace.wrapSpanContext`, activates it with `trace.setSpan` and `context.with`, and asserts that the
reader returns its ids inside and nothing outside. A version of the API that moves the registry or
renames the span key fails that test in both runtimes, before a release, rather than in an
application's logs. The test uses `wrapSpanContext` rather than `startActiveSpan` because, without an
SDK, the API's tracer yields all-zero ids, which the reader rejects.

## Considered options

- **The opt-in `@vipengele/ts/otel` entry point.** ADR-0008's shape: correct by contract, but
  correlation is off until the application adds a line it has to know about, and an application that
  already runs OpenTelemetry expects its logs to carry the trace without one.
- **A lazy dynamic `import('@opentelemetry/api')`.** A bundler either follows the specifier and
  bundles the peer into every application, or leaves it external and the import fails at runtime in
  a bundled browser app. The import is asynchronous too, so every record written before it settles
  misses the trace.
- **A static import.** Every consumer's bundler resolves the peer, so an application without
  OpenTelemetry either fails to build or pays for a package it never uses. That breaks "nothing when
  absent".

## Consequences

- Correlation is automatic: any application whose OpenTelemetry API registers a context manager gets
  `trace` on its log records.
- The registry key and the span key are a dependency the type system never sees; the contract test
  is what holds the package to them, and widening the peer range means running it against the new
  versions.
- A context manager whose `active()` throws costs each written record one caught exception, never
  the record.
