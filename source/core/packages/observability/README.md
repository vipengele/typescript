# @vipengele/ts-core-observability

Structured logging and error reporting for the browser and Node, as two entry points:

| Entry point | What it is |
|-------------|------------|
| `@vipengele/ts-core-observability/logger` | Category-scoped structured loggers with pluggable sinks and formatters |
| `@vipengele/ts-core-observability/errors` | An error reporter: capture, normalization, scopes, breadcrumbs and pluggable transports |

An application that only logs imports only `/logger` and bundles none of the reporter.

```sh
pnpm add @vipengele/ts-core-observability
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

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
