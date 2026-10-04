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
