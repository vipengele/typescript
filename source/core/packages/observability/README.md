# @vipengele/ts-core-observability

Structured logging and error reporting for the browser and Node, as two entry points:

| Entry point | What it is |
|-------------|------------|
| `@vipengele/ts-core-observability/logger` | Category-scoped loggers with configurable levels, sinks and redaction |
| `@vipengele/ts-core-observability/errors` | An error reporter: capture, normalization, scopes, redaction and pluggable transports |

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
disables it. A policy that carries `detectors` (for example `valueDetectors`) also replaces matched
spans in the string values of `attributes` and of an error's `data` and structured fields. A
record's `message`, the `message` and `stack` of a real `Error`, and a thrown string that is not
JSON are not scanned: a secret interpolated into one of those is the caller's to keep out.

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
  send(event: ErrorEvent, resource: Resource): void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}
```

`send` is fire-and-forget: it returns at once and never throws, and the reporter never awaits it —
batching, retry and the decision to drop belong to the transport. `resource` is the `Resource` read
from `Scope.resource()` once for that event at delivery, frozen, with all four keys present. `flush` resolves `true` once
everything accepted so far is delivered or dropped, `false` if `timeoutMs` elapses first; `close`
flushes, then turns every later `send` into a no-op.

**Two built-in transports:**

- `createConsoleTransport(options?)` writes each event to `console` (or `options.console`, for a
  test double): `error` and `fatal` go to `console.error`, `warn` to `console.warn`, `info` to
  `console.info`, and `trace` and `debug` to `console.debug`.
- `createTestTransport()` records every sent event on its `events` array, and the `Resource` it was
  sent with on `resources` at the same index, instead of delivering it anywhere, for asserting what a
  reporter sent without a network or a console. Its `clear()` empties both without affecting
  whether the transport is closed. `createConsoleTransport` does not print the Resource.

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
receives it as the second argument of `send`.

`./errors` re-exports `Scope` and the `Resource`, `ScopeAttributes` and `ScopeUser` types from
`@vipengele/ts-core-common/scope`, so a reporter-only application needs one import:

```ts
import { Scope } from "@vipengele/ts-core-observability/errors";

Scope.setResource({ "service.name": "checkout", "service.version": "1.4.2" }); // once, at startup

Scope.isolated("http-request", { requestId: "abc" }, () => {
  Scope.setUser({ id: "u-42", email: "ada@example.com" }); // user.id, user.email
  Scope.setTag("region", "eu-west"); // region
  Scope.setContext("cart", { id: "c-9", items: 3 }); // cart.id, cart.items

  Scope.inherit("checkout", { step: "payment" }, () => {
    reporter.captureException(error, { attributes: { orderId: 7 } });
    // attributes: { requestId, user.id, user.email, region, cart.id, cart.items, step, orderId }
  });
});
```

- **`Scope.setResource(partial)`** merges the four Resource keys into the realm's one root, in
  place: Loggers and Reporters already built read the merged values. A key that is `undefined` or
  not a string is skipped, never cleared or coerced; an unknown key is ignored; it never throws.
  `Scope.resource()` returns a frozen snapshot per call.
- **`Scope.setUser({ id, email, username })`**, **`Scope.setTag(key, value)`** and
  **`Scope.setContext(name, data)`** write flat dotted attribute keys to the current Scope:
  `user.id`, `user.email` and `user.username`; the plain `key`; and `name.field`, one level deep.
  Every key is validated before any is written, so a Resource key throws `ReservedScopeKeyError`
  and leaves nothing written. `setContext` needs a non-empty string `name`, else a `TypeError`.
  The event gains no `tags`, `user` or `contexts` field.
- **A Scope's tag** is its Breadcrumb; an Error Event carries no breadcrumb trail field.

**Redaction** — on by default, using the `secretKeys` preset from `@vipengele/ts-core-redaction`. A
stage after enrichment and before the processors applies the policy to the merged `attributes`, to
`mechanism.data` and to every link of the exception chain (`code`, `data`, and the JSON `message`
of a synthetic link), as the logger does for a record. The event's `message`, and each link's `stack`
and `frames`, are not scanned. A Transport receives an event that is already redacted.
`builder.redaction(policy)` replaces the policy and `builder.redaction(null)` disables redaction:

```ts
const reporter = createReporter((builder) => builder.transport(createConsoleTransport()).redaction(null));
```

`secretKeys` splits keys on every non-alphanumeric character, so a dotted key is read word by word:
`Scope.setContext("session", { id })` writes `session.id`, which the default masks, as it does
`Scope.setTag("sessionId", ...)` and `Scope.setContext("token", ...)`. A policy that throws drops
the event silently, as the logger drops a record.

If reading the Scope throws, the event is delivered without its Scope attributes. If reading the
Resource for `send` throws, the event is delivered with a Resource whose four keys are `undefined`;
the logger drops the record on the same throw, since an event is worth more than its Resource. In
the browser the synchronous-stack carrier loses the Scope after an `await` (ADR-0006).

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
