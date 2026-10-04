# @vipengele/ts-core-observability

Structured logging and error reporting for the browser and Node, as two entry points:

| Entry point | What it is |
|-------------|------------|
| `@vipengele/ts-core-observability/logger` | Category-scoped loggers with configurable levels |
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

**What does not exist yet:** sinks, formatters, configuration sources (`VPG_LOG`, browser sources,
files), Log Records and emit methods. They arrive with sinks (#27), formatters (#28), configuration
sources (#29), and records and emit methods (#25). A release cut before #25 ships a logger that
configures levels but cannot emit.

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
