# @vipengele/ts-core-observability

Structured logging and error reporting for the browser and Node, as two entry points:

| Entry point | What it is |
|-------------|------------|
| `@vipengele/ts-core-observability/logger` | Category-scoped loggers with configurable levels, sinks and redaction |
| `@vipengele/ts-core-observability/errors` | An error reporter: capture, normalization, scopes, breadcrumbs and pluggable transports |

An application that only logs imports only `/logger` and bundles none of the reporter.

```sh
pnpm add @vipengele/ts-core-observability
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## `./logger`

`Logging` is a frozen facade object (not a class) over a default `LoggerProvider` that every copy of
the package in a realm shares:

```ts
import { Logging } from "@vipengele/ts-core-observability/logger";

const log = Logging.logger("services.editing"); // module scope, costs nothing

Logging.configure((b) => b.addLevels({ services: "debug" })); // an application, never a library
Logging.override("services.editing", "trace"); // live, on top of the build
Logging.override("services.editing", null); // removes that override
Logging.reset(); // drops overrides and the builder layer, restoring the defaults

log.enabled("debug"); // reads the configuration in force on every call

const provider = Logging.createProvider((b) => b.addLevels({ "*": "trace" })); // isolated
```

- **Levels** — `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `off`. The default is `"*": "warn"`.
- **Categories** — dot-separated names; the longest dot-boundary prefix with a configured level
  governs, so `services` governs `services.editing` but not `servicesX`. `*` is the root.
- **Spec strings** — `parseSpec` reads `category:level,category:level`; an entry with a bad level
  or category is skipped and reported as an issue rather than failing the whole spec.
- **`LoggingConfigError`** — thrown for an invalid level or category in code, checked with
  `isLoggingConfigError`; a failed `configure` leaves the configuration in force untouched.
- **Warn target** — `Logging.configure` reports spec issues through `console.warn`, or through the
  function given to `setWarnTarget`. The target belongs to each copy of the package: a configure call
  made through another copy's default provider reports through that copy's target.
- **Two copies agree** — the default provider and the level table live behind shared `globalThis`
  slots, so a level raised through one copy reaches Loggers created by another.

**Emitting** — a `Logger` has six emit methods. The first three take no error; the last three take
the thrown value ahead of the attributes:

```ts
log.trace(message, attributes?);
log.debug(message, attributes?);
log.info(message, attributes?);
log.warn(message, error?, attributes?);
log.error(message, error?, attributes?);
log.fatal(message, error?, attributes?);

log.info("saved", { documentId: 7 });
log.error("save failed", caught, { documentId: 7 });
```

A call below the level in force does nothing. One that passes the check becomes a `LogRecord`:
`time` (epoch milliseconds with a sub-millisecond fraction), `level`, `category`, `message`,
`attributes`, and, when the call passed one, `error`, the thrown value serialized with its whole
`cause`/`errors` chain. The record carries the call's own attributes only.

**Sinks** — a `Sink` is an object with `write(record, resource)`, where `resource` is the `Resource`
in force when the record was emitted; that `(record, resource)` arity is part of the
`vipengele.logger.provider.v1` protocol. `builder.addSink(sink)` adds one, and every sink receives
every record in the order added:

```ts
const records: LogRecord[] = [];

Logging.configure((b) => b.addSink({ write: (record) => records.push(record) }));
```

- **Replacement** — `configure` replaces the sinks, never appends to those of an earlier call, and
  `Logging.reset()` drops them along with the overrides. A provider from `createProvider` owns its
  sinks alone and shares none with the default provider.
- **No sink** — with none configured, emit does nothing.
- **Clock** — `builder.clock(clock)` replaces the source of `time`; the default is `systemClock`
  from `@vipengele/ts-core-common`.
- **A throwing sink** never reaches the caller and never stops another sink from receiving the
  record. The failure is reported once per failing sink per record through the warn target, which
  belongs to each copy of the package, like spec issues.
- **A throwing clock or redaction policy** drops the record silently: no sink receives it, and the
  caller does not see the throw.
- **An async `write`** — a promise returned by `write` is neither awaited nor observed, so a
  rejecting async `write` is the sink's own to handle.

**Redaction** — on by default, using the `secretKeys` preset from `@vipengele/ts-core-redaction`. A
policy is applied to `attributes` and to every link of the error chain, when the record is created
and before any sink sees it: to the `data` of an `Error` and to its `code`, read under the key
`code`, and to the fields of a structured thrown value that is not an `Error` (a plain object, an
array, a parsed API error body), whether it was thrown itself or reached through a `cause` or an
`errors` entry. A thrown string that opens with `{` or `[` once leading whitespace and a byte order
mark are skipped is parsed and redacted the same way. Such a value's JSON text is replaced whole by
`"[REDACTED: unparseable structured value]"` when it does not parse, as when it was cut at the
serialization length bound. `builder.redaction(policy)` replaces it and `builder.redaction(null)`
disables it. A record's `message`, and the `message` and `stack` of an `Error`, are not scanned: a
secret interpolated into a message is the caller's to keep out.

**What the logger does not have:** formatters, and configuration sources (`VPG_LOG`, browser
sources, files). A sink formats a record itself, and levels are set in code, with `configure`,
`override` and spec strings.

## `./errors`

`createReporter` builds a `Reporter` from a builder, starting from the defaults — no transport,
`systemClock` from `@vipengele/ts-core-common` as the clock (the `Clock` type is exported from
`./errors`, to name what `builder.clock()` takes) — and a `configure` callback that adds to them:

```ts
import { createConsoleTransport, createReporter } from "@vipengele/ts-core-observability/errors";

const reporter = createReporter((builder) => builder.transport(createConsoleTransport()));

try {
  riskyThing();
} catch (error) {
  reporter.captureException(error, { attributes: { userId: 42 } });
}

reporter.captureMessage("checkout started", "info");
```

Every capture method turns its argument into an `ErrorEvent` — one normalized shape for a caught
error and its whole `cause`/`errors` chain, or a plain message — and hands it to the reporter's
transport. No capture method throws, and each returns the event's `id` whether or not the event
was delivered.

**The Transport contract** (ADR-0010) — where an Error Event goes once captured:

```ts
interface Transport {
  send(event: ErrorEvent): void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}
```

`send` is fire-and-forget: it returns at once and never throws, and the reporter never awaits it —
batching, retry and the decision to drop belong to the transport. `flush` resolves `true` once
everything accepted so far is delivered or dropped, `false` if `timeoutMs` elapses first; `close`
flushes, then turns every later `send` into a no-op.

**Two built-in transports:**

- `createConsoleTransport(options?)` writes each event to `console` (or `options.console`, for a
  test double): `error` and `fatal` go to `console.error`, `warn` to `console.warn`, `info` to
  `console.info`, and `trace` and `debug` to `console.debug`.
- `createTestTransport()` records every sent event on its `events` array instead of delivering it
  anywhere, for asserting what a reporter sent without a network or a console. Its `clear()` empties
  `events` without affecting whether the transport is closed.

**No transport configured** — the reporter still normalizes and returns an event `id` for every
capture, but the event reaches nowhere: it is dropped once the pipeline runs. `flush` and `close`
resolve `true` in that case, since there is nothing to wait on.

**An unknown level** — a `CaptureContext.level` or `captureMessage` level that is not one of the six
`Level` values (or is absent) becomes `"error"`.

### Scopes

An Error Event's `attributes` carry the ambient `Scope` chain beneath the call's own attributes: the
attributes of every Scope between the current one and the root, the innermost winning, then the
`attributes` passed to the capture call, which win on a shared key. Each side is normalized
separately and bounded to 100 entries. The Resource (`service.name`, `service.version`,
`deployment.environment.name`, `process.runtime.name`) is not copied into events; a `Transport`
that needs it reads `Scope.resource()`.

The reporter only reads the Scope. Per-request isolation, tags and `withScope`-style behaviour come
from `Scope` in `@vipengele/ts-core-common/scope`:

```ts
import { Scope } from "@vipengele/ts-core-common/scope";

Scope.isolated("http-request", { requestId: "abc" }, () => {
  Scope.current().set("userId", 42); // set after the request began, still reaches later events

  Scope.inherit("checkout", { cartId: "c-9" }, () => {
    reporter.captureException(error, { attributes: { step: "payment" } });
    // attributes: { requestId: "abc", userId: 42, cartId: "c-9", step: "payment" }
  });
});
```

The reporter does not redact: Scope attributes reach the Transport as set, exactly as the call's own
attributes do, so a secret placed on a Scope is sent. Keep secrets out of `Scope.current().set`,
`Scope.inherit` and `Scope.isolated` attributes, or redact the event inside a custom `Transport`'s
`send` before it leaves the process. A `ReporterBuilder` registers no event processors.

If reading the Scope throws, the event is delivered without its Scope attributes. A Scope's tag is a
Breadcrumb, and the Breadcrumb trail is not part of an Error Event. In the browser the synchronous-stack
carrier loses the Scope after an `await` (ADR-0006).

### Stack frames

Every `ExceptionRecord` — the event's `exception` and each `cause` and `errors` link under it —
carries `frames: StackFrame[]`, parsed from its `stack`:

```ts
interface StackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  inApp?: boolean;
}
```

V8, SpiderMonkey and JavaScriptCore stacks all parse, and a line that is not a frame (the
`Error: message` header, `[native code]`, a truncation marker) is dropped. The raw `stack` stays a
string on the record and is the lossless record; `frames` is a convenience over it. Parsing never
throws, and a missing or unreadable stack gives `[]`. `frames` is set in the normalize stage, so
processors see it.

**Frame order** is the engine's: `frames[0]` is the throw site. A transport that targets a
bottom-first format reverses the array at its own edge.

**In-app** — `inApp: true` marks the application's own code. A frame is not in-app when:

- it has no `file`;
- its `file` has a `node_modules` path segment, whether it is a filesystem path or an `http(s)://`
  URL;
- its `file` uses the `node:` scheme.

Every other frame is in-app when no project root is set. With a root, a frame is in-app only when
its `file` is under the root on a path boundary: `/app` covers `/app/x.js` but not
`/application/x.js`. `file://` URLs and backslashes are normalised before comparing, so
`C:\app\x.js` and `file:///C:/app/x.js` match the same root. An empty or whitespace-only root
counts as unset.

`builder.projectRoot()` sets the root. It takes a filesystem path or a URL prefix, since a browser's
frames are URLs:

```ts
const nodeReporter = createReporter((builder) => builder.projectRoot("/srv/checkout"));
const browserReporter = createReporter((builder) => builder.projectRoot("https://app.example.com/"));
```

**No self-detection** — the reporter does not mark its own frames not-in-app. Deriving its location
from `import.meta.url` is wrong under bundling: it resolves to the application's bundle, so every
application frame would be marked not-in-app. Unbundled, the reporter's frames sit under
`node_modules` and are already not in-app. Bundled into an application, its own frames are in-app;
that is accepted.

### Global handlers

`builder.add(integration)` installs an `Integration` when the reporter is created and removes it
again on `close()` (ADR-0012):

```ts
interface Integration {
  readonly name: string;
  setup(host: IntegrationHost): (() => void) | void;
}

interface IntegrationHost {
  capture(error: unknown, context: { mechanism: Mechanism; level?: Level; attributes?: AttributesInput }): string;
  flush(timeoutMs?: number): Promise<boolean>;
}
```

`setup` returns the function that undoes it, if there is anything to undo. Integrations are set up in
the order added and torn down newest first. A `setup` or a teardown that throws is contained: that
integration is skipped, and every other one still installs or tears down. Adding a second
integration with the same `name` replaces the first, in its place, so one builder installs each
integration once.

`globalHandlers` captures what nothing else caught, as `handled: false` events with the
`global.error` and `global.rejection` mechanisms:

```ts
import { createConsoleTransport, createReporter, globalHandlers } from "@vipengele/ts-core-observability/errors";

const reporter = createReporter((builder) =>
  builder
    .transport(createConsoleTransport())
    .add(globalHandlers({ onUncaught: "exit", onUnhandledRejection: "exit", flushTimeoutMs: 2000 })),
);
```

- **`onUncaught` and `onUnhandledRejection`** — each `"exit"` or `"continue"`, and both required.
  There is no default: whether a process survives an unhandled error is a decision about the
  application, and a default would make it silently on the caller's behalf.
- **`flushTimeoutMs`** — how long an `"exit"` waits for the transport to flush. Defaults to `2000`.
- **`eventTarget` and `process`** — inject a fake in a test. An injected `eventTarget` wins, then an
  injected `process`, then `globalThis` where it has an `addEventListener`, then `globalThis.process`;
  a runtime with none of them installs nothing.

**In the browser** it listens for `error` and `unhandledrejection` on `globalThis` and captures both
at level `error`. It never exits, ignores the exit options and `flushTimeoutMs`, and never calls
`preventDefault`, so the browser still reports each error to its own console. A cross-origin
`"Script error."` arrives without its `error`; it is captured as an exception built from the event's
`message`.

**In Node** it listens for `uncaughtException` (captured at level `fatal`) and `unhandledRejection`
(level `error`), always both. A listener switches off Node's own crash report and exit, so the exit
policy decides what follows:

- **`"exit"`** writes the error to `console.error` first, so a transport that does not write to the
  console still leaves a trace of the crash, then awaits `flush(flushTimeoutMs)` and calls
  `process.exit(1)` whether or not the flush finished. A second error with an `"exit"` policy while
  that flush is pending exits at once, and the first event may be lost.
- **`"continue"`** captures the event and leaves the process running.

> **Warning: `"continue"` keeps a process Node considers corrupt.** After an uncaught exception
> Node treats the process state as undefined: open handles, half-finished writes and invariants the
> code relied on may be broken. `"continue"` for `onUncaught` is a deliberate choice to keep running
> anyway; `"exit"` is the safe one.

A reporter with integrations owns the global state they install until `close()`. Two reporters that
both add `globalHandlers` each install their own listeners, and each captures every error.
