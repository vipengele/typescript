# OpenTelemetry is an opt-in entry point, never a detected global

`@opentelemetry/api` is an optional peer (`^1.9`, marked optional in `peerDependenciesMeta`),
imported only by the `@vipengele/ts/otel` entry point. An application without OpenTelemetry never
imports that entry point, so its bundler never resolves the peer and it pays nothing. An
application with OpenTelemetry opts in through the builders (ADR-0005), with the same objects for
the logger and the reporter, so their trace ids agree by construction:

```ts
import { OtelLogging, OtelTrace } from '@vipengele/ts/otel';

Logging.configure(b => b
  .add(OtelTrace.correlation({ baggage: ['tenant.id'] }))
  .add(OtelLogging.bridge()));
const reporter = createReporter(b => b.add(OtelTrace.correlation({ baggage: ['tenant.id'] })));
```

## Why not read OpenTelemetry's global registration

`@opentelemetry/api` registers itself on `globalThis[Symbol.for('opentelemetry.js.api.1')]`, and
its span key is `Symbol.for('OpenTelemetry Context Key SPAN')`; reading those would correlate traces
with no import and no configuration. Both are implementation details, not the package's contract,
and a change to either would switch correlation off silently — indistinguishable from a request that
had no span. The explicit entry point costs one line next to where the application already starts
its OpenTelemetry SDK.

## What is read

- **Always:** the active span's `traceId`, `spanId` and `flags`, taken when a record or event is
  created, into its `trace` field (ADR-0007).
- **Baggage, only by allowlist:** the named entries are copied into `attributes`, and redaction
  runs over them. Baggage arrives from upstream in the `baggage` header, so any caller — untrusted
  ones included — controls it; it often carries identifiers not every log destination may receive;
  and it can be 8 KiB per request. Copying all of it lets a client inject attributes into our logs.

## Bridge or export, never both

- `OtelLogging.bridge()` is a Sink that emits records through the application's own
  `LoggerProvider`, sharing its exporter, processors and batching.
- The OTLP Transport is the framework's own export, for applications without the OpenTelemetry SDK.

An application picks one. Both would export every record twice, so the builder warns once when it
sees both.

## Exceptions are log records

Error Events are exported as log records carrying the stable `exception.type`,
`exception.message` and `exception.stacktrace` attributes, never as span events. OpenTelemetry is
deprecating exception span events in favour of exception log records;
`OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN` exists for SDKs migrating from span events, and a mapping
that starts at the destination has nothing to migrate. The semantic-conventions version the mapping
targets (v1.37) is a constant in the Transport, raised deliberately rather than followed.

## The Scope and OpenTelemetry's context are independent

See ADR-0006: the Scope is never carried inside OpenTelemetry's `Context`, and neither creates the
other.

## Considered options

- **Detecting OpenTelemetry through its global registration.** Rejected above.
- **Copying all baggage.** Injection and personal data, above.
- **Never reading baggage.** A tenant id already propagated through the system would have to be
  copied into the Scope by hand at every service boundary.
- **Always bridging.** Applications without the SDK would get nothing.
- **Always exporting ourselves.** Applications with OpenTelemetry would export twice or run a
  second pipeline.
- **Exceptions as span events.** The destination OpenTelemetry is leaving.
