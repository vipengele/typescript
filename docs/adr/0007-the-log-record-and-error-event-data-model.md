# The Log Record and Error Event data model

Log Records and Error Events are the framework's own types, named for the TypeScript code that reads
them, and every field maps onto the OpenTelemetry log data model by a rename, so each Transport
stays thin. Both share one error type, one attribute type and one level type from
`@vipengele/ts-core-common`.

```ts
type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type Threshold = Level | 'off';                       // configuration only

type AttributeValue =
  | string | number | boolean | null
  | readonly AttributeValue[]
  | { readonly [key: string]: AttributeValue };
type Attributes = Readonly<Record<string, AttributeValue>>;   // what Sinks receive
type AttributesInput = Readonly<Record<string, unknown>>;     // what callers pass

interface SerializedError {
  type: string;
  message: string;
  code?: string;                  // VipengeleError.code (ADR-0002), or a Node errno code
  stack?: string;                 // raw
  synthetic?: true;               // the thrown value was not an Error
  data?: Attributes;              // own enumerable properties
  cause?: SerializedError;
  errors?: SerializedError[];     // AggregateError.errors
}

interface LogRecord {
  time: number;                   // epoch ms with a sub-ms fraction, from an injectable clock
  level: Level;
  category: string;
  message: string;
  attributes: Attributes;
  error?: SerializedError;
  trace?: { traceId: string; spanId: string; flags: number };
}

interface ErrorEvent {
  id: string;                     // 32 hex characters, generated at capture
  time: number;
  level: Level;                   // 'error' unless the process is going down
  message?: string;
  exception?: ExceptionRecord;    // absent only for a captured message
  mechanism: Mechanism;
  attributes: Attributes;
  breadcrumbs: Breadcrumb[];      // a copy of the Unit of Work's buffer at capture
  fingerprint?: string[];
  trace?: { traceId: string; spanId: string; flags: number };
}

interface ExceptionRecord extends SerializedError {
  frames: StackFrame[];
  cause?: ExceptionRecord;
  errors?: ExceptionRecord[];
}

interface Mechanism {
  handled: boolean;               // did the application catch it
  source:                         // who handed it to the reporter
    | 'capture' | 'logger' | 'global.error' | 'global.rejection'
    | 'console' | 'network' | `integration.${string}`;
  data?: Attributes;
}

interface Breadcrumb {
  time: number;
  category: string;               // 'log', 'http', 'navigation', 'ui.click', or custom
  level: Level;
  message?: string;
  data?: Attributes;
}
```

## Mapping onto OpenTelemetry

| Framework | OTLP log record |
|---|---|
| `time` | `timeUnixNano` (× 10⁶ at the Transport); `observedTimeUnixNano` set by the Transport |
| `level` | `severityText`; `severityNumber` trace 1, debug 5, info 9, warn 13, error 17, fatal 21 |
| `category` | `InstrumentationScope.name` |
| `message` | `body` |
| `attributes` | `attributes` (nested maps and arrays are valid `AnyValue`s) |
| `error` / `exception` | `exception.type` and `exception.message` from the outermost error; `exception.stacktrace` as the whole chain in the JVM's `Caused by:` layout |
| `trace` | `traceId`, `spanId`, `flags` |
| the root Scope | `ResourceLogs.resource`, once per payload |

OpenTelemetry's names are the vocabulary of one Transport; `message`, `level` and `category` are
what a Sink author expects. The error stays a structured tree inside the process because flattening
it at capture, as the exception semantic conventions do, loses the `cause` chain and
`AggregateError.errors` the console formatter and the reporter need. Time is milliseconds because a
nanosecond `timeUnixNano` needs a `bigint`, which is not JSON-safe; the fraction from
`performance.now()` keeps records written within one millisecond ordered.

## Levels

Six levels, each at the base of its OpenTelemetry severity range, and nothing between them.
Presentational kinds (consola's `success`, `start`, `box`) are attributes a formatter styles, not
levels. `off` is a Threshold, never a Level: no record is `off`, no Sink handles it, and `'*': 'off'`
silences `warn` and `error` too. Level names are validated by own property (`Object.hasOwn`), so
`'constructor'` is not a level. The console receives `trace` and `debug` on `console.debug`, so
DevTools' Verbose filter separates them from `info`; `console.trace` is never used, since it prints
a stack on every call.

## Attributes are normalized once, when the record is created

Callers pass `AttributesInput`: a `User` interface or class instance has no implicit index
signature, so the strict `Attributes` type would reject the very values people log. The normalizer
turns input into `Attributes` once, when the record is created and only if its level is enabled —
a snapshot, so a caller mutating its object afterwards cannot change what a later or asynchronous
Sink sees, and a filtered-out record costs nothing. `toJSON()` is honoured, so a class decides its
own logged shape; otherwise own enumerable properties are taken. `bigint`, `Map`, `Set`, `Date`,
cycles, functions, symbols and nested errors are coerced, never thrown on, and depth (6), breadth
(100) and string length (8 KiB) are bounded by builder-configurable limits, with truncation marked.
Redaction runs at the same point, before any Sink. Every record a Sink receives is JSON-safe,
bounded and redacted.

## One error type for both

`log.error(message, error)` and `captureException(error)` produce the same `SerializedError` tree
through one normalizer. The chain through `cause` and `errors` is followed to five links, cycle-safe,
with the cut marked. Stack parsing stays in the reporter: `ExceptionRecord` adds parsed `frames` and
is a structural superset, so anything that reads a `SerializedError` reads an Error Event's
exception, and the logger bridge only adds frames rather than translating.

## The Resource is sent once

The root Scope (ADR-0006) is the Resource — `service.name`, `service.version`,
`deployment.environment.name`, `process.runtime.name` — and is not copied into records or events.
`attributes` is the chain from the default scope inward. Transports attach the Resource once per
payload, and Sinks receive it alongside each record.

## What an Error Event adds

- **Mechanism** separates two facts: whether the application caught the error (`handled`), and who
  handed it over (`source`, after Datadog's taxonomy). Unhandled errors are the signal behind
  alerting and crash-free rates; `global.rejection` points straight at a missing `await`.
  Integrations use `integration.<name>`, so a new one needs no change to the type.
- **Breadcrumbs** are the trail of recent events in the Unit of Work — records, requests,
  navigations, clicks — copied at capture because the buffer keeps rolling. A debug record can be a
  breadcrumb without being written anywhere, which makes them cheap context while logging stays
  quiet.
- **No separate `tags`, `extra` or `user`**, unlike Sentry: everything is `attributes`, and
  `Scope.setUser` writes OpenTelemetry's `user.*` keys. Which attributes a backend indexes is the
  Transport's decision.
- **`id`** exists from capture, so deduplication and a report ID shown to a user refer to the same
  event before it is sent.

## Considered options

- **OpenTelemetry's names verbatim** (`body`, `severityNumber`, `attributes['exception.type']`).
  Every Sink reads OTLP vocabulary and the error chain is lost at capture.
- **consola's positional `args: any[]`.** No structure to map onto anything.
- **Primitive-only attributes**, as for OpenTelemetry span attributes. Structured payloads get
  flattened into dotted keys by hand at every call site.
- **`unknown` attributes serialized by each Sink.** Every Sink repeats the work with its own
  bugs, and the caller's object can change before an asynchronous Sink reads it.
- **Separate error types for the logger and the reporter.** The bridge between them translates,
  and the two drift.
- **Stack parsing in `common`.** Every `log.error` pays for it.
- **The Resource merged into every record's attributes.** Repeats identical keys on every record
  and mixes who is emitting with what happened.
