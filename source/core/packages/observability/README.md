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

Either `attributes` argument may be a function, `AttributesThunk` (`() => AttributesInput`, a type
exported from `@vipengele/ts-core-observability/logger`), computed only when the record is written:

```ts
log.debug("state", () => ({ snapshot: expensiveSnapshot() })); // runs only if a debug record is written
log.error("save failed", caught, () => ({ documentId: doc.id }));
```

- **Dispatch** — only the `attributes` argument is read as a thunk. In `warn`, `error` and `fatal` a
  function in the `error` position is an error value, serialized like any thrown value, never a
  thunk; pass `undefined` there to give a thunk in the third position.
- **Once per record** — the thunk runs after the level check and the no-sink check, once however
  many sinks receive the record, and before normalization and redaction, so a secret key it returns
  is redacted like any other.
- **Failure** — a thunk that throws, or returns anything but a record (a string, array, `null`,
  `undefined`, number or function), gives `{}` for its layer. The record is still written, and
  nothing is reported to `onSinkError`, which is for sinks and processors.
- **No re-entry** — while any attributes thunk runs, every other thunk, per-call or bound, on any
  logger of the same copy of the package gets `{}`, so a thunk that logs cannot recurse. The flag
  belongs to each copy of the package; a thunk that recurses through a second copy is not stopped.

A call below the level in force does nothing. One that passes the check becomes a `LogRecord`:
`time` (epoch milliseconds with a sub-millisecond fraction), `level`, `category`, `message`,
`attributes`, and, when the call passed one, `error`, the thrown value serialized with its whole
`cause`/`errors` chain.

**Bindings** — `log.with(attributes)` returns a new `Logger` for the same category whose records
carry those attributes:

```ts
const requestLog = log.with({ requestId: "abc" });

requestLog.info("saved", { documentId: 7 }); // attributes: { requestId, documentId }
requestLog.with({ requestId: "def" }); // overrides the parent's requestId
```

- **Bound once** — the attributes are normalized and deeply frozen when `with` is called, so later
  changes to the object passed in do not reach the Logger. Redaction still runs when a record is
  emitted, over the whole record.
- **Detached and live** — the returned Logger is frozen and works detached from the object, so
  `const { info } = requestLog` is safe. It shares the parent's level configuration and emit
  settings, so a level change through `Logging.override` or `configure` reaches it.
- **No attributes** — `with({})` returns the same Logger.

`log.with(thunk)` binds attributes computed lazily:

```ts
const sessionLog = log.with(() => ({ user: currentUser().id }));

sessionLog.debug("not written"); // below the level: the thunk does not run
sessionLog.info("opened"); // first record with a sink: the thunk runs, the result is kept
sessionLog.info("saved"); // reuses the kept result
```

- **At most once** — the thunk runs at the bound Logger's first record that passes the level check
  and has a sink; the result is normalized, deeply frozen and reused. If it throws, that record gets
  `{}` for the binding and the failure is not kept, so the next record runs the thunk again.
- **Children** — a Logger made by `with` on `sessionLog` carries the value when `sessionLog` has
  already evaluated it, as a fixed value. If `sessionLog` has not, the child holds its own cell and
  runs the thunk at its own first record, so parent and child can hold different values.
- **Order** — `with(thunk).with({ x })` lets the static `x` win over the same key from the thunk. A
  thunk always makes a new Logger, even though `with({})` returns the same one.
- **The first record decides** — a thunk that reads ambient context such as the Scope captures the
  context of that first record for every later one. A value that follows each record belongs in
  the Scope's attributes, not in a bound thunk.

**Scope attributes** — every record that passes the level check and has a sink also carries the
attributes of the ambient `Scope` chain (`snapshot(Scope.current())`, from `./scope` of
`@vipengele/ts-core-common`), never the Resource keys. Attributes merge from least to most
specific: Scope, then the Logger's bindings, then the call's own attributes, the more specific layer
winning a shared key. Each layer is normalized separately; the reporter merges its events with the
same helper. If reading the Scope throws, the record is emitted without its Scope attributes.

- **Browser** — without an async-context carrier, the Scope is lost after an `await` (ADR-0006), so
  a record emitted after one carries no Scope attributes. Bind what must survive an `await` with
  `with`.
- **Cost** — the Scope is read on every record that passes the level check and has a sink; there is
  no opt-out. The same rule governs the rest of the work: an attributes thunk, the clock and the
  emit settings run once per record, after the level and sink checks.

**Hot path** — a disabled call makes the Logger allocate nothing and run nothing: no thunk, clock,
Scope read or emit settings read. A category with nothing configured resolves through one shared,
frozen level entry. What the caller writes is its own cost: an arrow function inline at a disabled
call site still allocates a closure, which the Logger cannot avoid. The free guard is
`enabled`:

```ts
if (log.enabled("debug")) {
  log.debug("state", { snapshot: expensiveSnapshot() });
}
```

The test suite checks this in both runtimes (nothing runs for a disabled or sinkless call) and in
Node (heap growth of 1e5 disabled calls with one hoisted thunk stays under 256 KB).

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
  record. The default warn path reports each failing sink or processor once per configuration,
  through the warn target, which belongs to each copy of the package, like spec issues. The set of
  reported sources is cleared by `configure` and `Logging.reset()`, not by `override`; a sink added
  twice, or a processor shared by the global chain and a sink's chain, is reported once. The warn
  says whether a sink or a processor failed. A host that builds a provider with its own
  `onSinkError(error, source)` receives every failure, with the failing sink or processor as
  `source`, unless it also sets `sinkErrorsOncePerSource: true`.
- **Another record protocol** — a copy that finds a `vipengele.logger.provider.<version>` slot other
  than `v1` on `globalThis` warns once, the first time its default provider is resolved: sinks
  configured on one protocol do not receive the other's records.
- **A throwing clock or redaction policy** drops the record silently: no sink receives it, and the
  caller does not see the throw. A throwing Scope read is the exception: the record is emitted
  without its Scope attributes.
- **An async `write`** — a promise returned by `write` is neither awaited nor observed, so a
  rejecting async `write` is the sink's own to handle.

**Processors** — a `LogProcessor` is `(record: LogRecord) => LogRecord | null`: it returns the
record to pass on, the one it was handed or another, or `null` to drop it. `builder.addProcessor(p)`
runs ahead of every sink; `builder.addSink(sink, { processors: [p] })` runs ahead of that sink only,
after the global chain. Each chain runs in the order added, each processor on what the previous one
returned:

```ts
Logging.configure((b) =>
  b
    .addProcessor((record) => (record.category === "noisy" ? null : record))
    .addSink(consoleSink)
    .addSink(remoteSink, { processors: [redactionProcessor(strictPolicy)] }),
);
```

- **Fail closed** — a processor that throws, or returns neither a record nor `null`, drops the
  record. A global processor drops it for every sink; a per-sink processor drops it for that sink
  alone. The failure is reported like a sink's. A returned value that is not an object, lacks
  `time`, `level`, `category` or a string `message`, or carries an `error` link without a string
  `type` and `message`, counts as a failure.
- **Output is re-normalized** — a returned record is rebuilt from the `LogRecord` fields alone, so
  any other key is dropped. Its `attributes` and each error link's `data` go back through the
  attribute normalization, and its error chain is bounded by the same limits as a thrown error's:
  each link's `message` and `stack` are cut at 8192 characters, as for a thrown error, and its
  `type` and `code` are cut as well because a processor's strings are arbitrary, a link more than 5 links from
  the outermost one becomes a `"[Truncated]"` link, an `errors` array keeps 100 entries and
  summarises the rest in one `"[Truncated]"` entry, and an error link that recurs on its own chain
  becomes a `"[Circular]"` link. Links passed on from the record the processor was handed are kept
  as they are. The rebuilt copy is deeply frozen, so a sink only receives JSON-safe, bounded,
  frozen records and the processor's own objects stay unfrozen. The record `redactionProcessor`
  returns, redacted from the record it was handed, is already JSON-safe, bounded and deeply frozen,
  so only its `time`, `level`, `category` and `message` are checked and its `attributes` and error
  are kept without a second pass; a copy a processor makes of it is re-normalized like any other.
- **Validation** — `build()` throws `LoggingConfigError` for a processor that is not a function,
  `addSink` options that are not an object, or `processors` that is not an array.
- **The reporter's `ErrorEventProcessor`** — `./errors` exports `ErrorEventProcessor`, the same
  shape for an `ErrorEvent`: `(event: ErrorEvent) => ErrorEvent | null`, with `null` dropping the
  event. The reporter's drops are described under "Pipeline control" below.

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

Built-in redaction is the first stage, ahead of every processor, so a processor sees a redacted
record. `redactionProcessor(policy = secretKeys)` is the opt-in extra for a different policy on one
sink: it redacts `attributes` and the error chain with that policy and does not scan `message`.

**Formatters and the console sink** — a `Formatter` is an object with `format(record, resource)`
that returns the arguments of one console call. It never picks the console method: the console sink
routes by level (`error` and `fatal` to `console.error`, `warn` to `console.warn`, `info` to
`console.info`, `trace` and `debug` to `console.debug`, never `console.trace`) and calls
`console[method](...formatter.format(record, resource))`.

```ts
import { createConsoleSink, Logging } from "@vipengele/ts-core-observability/logger";

Logging.configure((b) => b.addSink(createConsoleSink()));
```

`createConsoleSink({ formatter?, console?, source? })` returns a `Sink`:

- **Selection** — an explicit `formatter` always wins. Without one the runtime's capabilities pick:
  `consoleStyling` gives `browserFormatter`, else `ansiColour` gives `ansiFormatter`, else
  `jsonLinesFormatter`. Deno offers both capabilities and gets the browser formatter. `source`
  stands in for `globalThis` when the capabilities are read. The formatter is resolved once, when
  the sink is created.
- **Console** — `console` defaults to `globalThis.console`, read on every write. A `ConsoleLike`
  has `error`, `warn`, `info` and `debug`.
- **Failure** — a formatter that throws propagates out of `write` to the provider's `onSinkError`,
  as any sink's failure does.

The three formatters:

- **`jsonLinesFormatter`** — one JSON object per line, keyed `time`, `level`, `category`,
  `message`, `attributes`, `error` (absent without one) and `resource`. `time` stays the record's
  epoch milliseconds as a number, sub-millisecond fraction included.

  ```text
  {"time":1760000000123.456,"level":"info","category":"app.checkout","message":"order placed","attributes":{"orderId":"o-1"},"resource":{"service.name":"checkout"}}
  ```

- **`ansiFormatter`** — one coloured line for a terminal: a dim UTC ISO 8601 time, the level in its
  colour, the category in bold, the message, the attributes as compact JSON, then the error with
  its stack and `cause` chain on the following lines.

  ```text
  2025-10-09T08:53:20.123Z INFO  app.checkout order placed {"orderId":"o-1"}
  ```

- **`browserFormatter`** — a `%c` format string for the time, level and category with a CSS
  argument for each, then the message, the attribute object and the serialized error as separate
  arguments, so DevTools can expand them.

  ```text
  %c2025-10-09T08:53:20.123Z %cINFO %capp.checkout, <css>, <css>, <css>, "order placed", { orderId: "o-1" }
  ```

A console reads the first string argument as a format string (`%s`, `%d`, `%c`, `%o`, ...), so user
text there is mangled or swallows the next argument. The built-in formatters return their text
behind `"%s"`, or escape `%` as `%%` in the format string they build. A `Formatter` of your own must
do the same and never hand a message, category or attribute value to the first argument unescaped.

### Configuration sources

A level spec reaches the logger from the defaults, from sources the builder adds, from live
overrides and from the `VPG_LOG` environment variable. Lowest first, a higher layer's level for a
category replacing a lower one's:

1. **Defaults** — `"*": "warn"`.
2. **Builder sources** — `addLevels`, `addSpec` and `addBrowserSources`, in the order added, a later
   source replacing an earlier one's entry for a category.
3. **Live overrides** — `Logging.override` and the console handle.
4. **`VPG_LOG`** — beats an override for the same category.

**`VPG_LOG`** — a level spec read from `process.env`:

```sh
VPG_LOG="*:warn,services:debug" node server.js
```

- **One lazy read** — each provider reads it once, on its first `configure`, `override` or `reset`
  or on the first level check of one of its Loggers, whichever comes first, never on import. The
  levels are published to the shared level table, so a module-scope Logger and every copy of the
  package see them with no `configure` call. A `createProvider` provider reads it too.
- **Bad entries** — an entry with a bad level or category is skipped and reported through the warn
  target, the warning naming `VPG_LOG`. A missing `process.env`, a non-string value or a throwing
  read means no spec. Nothing reaches the caller.
- **It stays** — `clearDefaults()` and `Logging.reset()` keep it; only `.ignoreEnvironment()` on the
  builder removes it, for as long as that configuration is in force. A later `configure` that does
  not call it restores the layer.

```ts
Logging.configure((b) => b.ignoreEnvironment().addLevels({ "*": "info" }));
```

**Browser sources** — `addBrowserSources(options?)` reads a level spec from `localStorage` and from
the URL, and does nothing outside a browser:

```ts
Logging.configure((b) => b.addBrowserSources().addSink(createConsoleSink()));
// https://example.test/app?log=services:trace
```

- **Options** — `BrowserSourcesOptions` is `{ urlParameter?, storageKey? }`, defaulting to `log` and
  `vipengele.log`. Each is a non-empty string; anything else makes `build()` throw
  `LoggingConfigError`.
- **Order** — storage is added before the URL, so the URL wins where both set a category.
- **Guarded reads** — a throwing access, a missing `location` or blocked storage means no source. An
  empty stored string counts as absent: no warning, nothing cleared.
- **Bad entries** — warned like any spec, each warning naming the URL parameter or the storage key.
- **An unreadable stored spec** — a non-empty stored string that holds no level is removed from
  storage, but only once the configuration built from it is in force: `build()` touches no storage
  and a rejected `configure` removes nothing. A bad URL parameter never removes good stored
  levels.

**Console handle** — `installConsole(name)` puts a function on `globalThis[name]` for changing
levels live from the browser console, and returns the function that removes it:

```ts
const uninstall = Logging.installConsole("logging");
// in the console:
logging("services:debug,*:warn"); // a spec string
logging({ levels: { services: "debug" } }); // a { levels } object
logging(null); // removes every override and the stored spec
logging(); // reports the levels in force
uninstall();
```

`LoggerProvider.installConsole(name)` does the same for a provider from `createProvider`.

- **Input** — `ConsoleHandleInput` is a spec string, `{ levels }`, `null` or nothing; the handle's
  type is `ConsoleHandle`. A spec or `{ levels }` is validated whole before anything is written: a
  skipped or repeated entry, or a spec that sets no level, throws `LoggingConfigError` and changes
  nothing. A valid one is merged into the overrides, as `override` sets them.
- **Persistence** — only when the build in force has browser sources, the change is merged into the
  spec stored under their storage key. It never writes the URL parameter. Blocked storage leaves
  the change in force for this page only, and the confirmation says so.
- **Confirmation** — every call writes one `info` record under the category
  `vipengele.logger.console`, whatever level governs that category, through the processors and
  sinks in force. It lists the levels in force, names every override `VPG_LOG` takes precedence
  over, and says whether the change was stored. With no sink in force the same line goes to the
  `warn` provider option; the default provider and a `createProvider` provider use the warn target,
  and a provider built without the option uses `console.warn`.
- **Name collision** — `LoggingConfigError` when `globalThis[name]` holds anything but `undefined`
  or a console handle. Installing the same name again replaces the earlier handle, and the
  returned function removes a handle only while it is still the one installed.
- **Another copy's provider** — `Logging.installConsole` throws `LoggingConfigError` when the
  default provider in the realm was created by a copy of the package that has no `installConsole`.

**Persistence caveat** — a spec the console handle stored comes back on the next load as a builder
source: below the overrides and below any source added after `addBrowserSources`. `Logging.reset()`
does not clear storage; `logging(null)` does.

**Types** — `BrowserSourcesOptions`, `BrowserSourcesSetting` (`{ storageKey }`, what
`LoggingSettings.browserSources` and `LoggingBuild.browserSources` hold, or `null` when the build
read no browser sources), `ConsoleHandle` and `ConsoleHandleInput` are exported. `LoggingBuild` also
carries `ignoreEnvironment`, and `LoggerProviderOptions` takes `environment()`, which reads the raw
`VPG_LOG` value (`Logging` supplies it from `process.env`; a provider built without it has no
environment layer), and `warn(message)`, the destination of a console handle's confirmation when
no sink is in force.

**What the logger does not have:** configuration files. Levels are set in code, with `configure`,
`override` and spec strings, and from `VPG_LOG` and the browser sources above.

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
batching, retry and the decision to drop an event it cannot deliver belong to the transport. `resource` is the `Resource` read
from `Scope.resource()` once per event at capture, before any stage runs, frozen, with every key
present; the same `Resource` the environment gate read is the one `send` receives. `flush` resolves `true` once
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

### Pipeline control

A drop has one of two owners (ADR-0020). A delivery drop, a full queue or exhausted retries, belongs
to the Transport. A policy drop, whether the event should be reported at all, belongs to the
Reporter, and the builder configures it. Every capture runs these stages in order:

1. the `enabledEnvironments` gate
2. `sampleRate`
3. normalize
4. `ignoreErrors`
5. enrich
6. redaction
7. processors
8. `beforeSend`
9. deduplication
10. rate limit
11. transport (`send(event, resource)`)

Every drop, at any stage, still returns the event's `id`, and no capture method throws. A dropped
event never blocks the `"exit"` sequence of a global handler.

```ts
type ErrorEventProcessor = (event: ErrorEvent) => ErrorEvent | null;
```

| Builder method | Default | Effect |
| --- | --- | --- |
| `addProcessor(processor: ErrorEventProcessor)` | none | Appends a processor, run in the order added. |
| `beforeSend(hook: ErrorEventProcessor)` | none | Sets the one hook that runs after every processor; a later call replaces it. |
| `sampleRate(rate: number)` | `1` | Keeps an event when `random() < rate`; `rate` is from 0 to 1. Runs before normalization. |
| `random(source: () => number)` | `Math.random` | The number each event is sampled with, in `[0, 1)`. |
| `ignoreErrors(patterns: readonly (string \| RegExp)[])` | `[]` | Drops an event a pattern matches. |
| `dedupe(enabled: boolean)` | `true` | Drops an event that repeats the last one that passed. |
| `rateLimit(limit: false \| RateLimitOptions)` | `{ burst: 60, perMinute: 60 }` | A token bucket; `false` turns it off. |

`RateLimitOptions` is `{ burst: number; perMinute: number }`, both positive finite numbers. An invalid
argument throws `ReporterConfigError` and leaves the builder unchanged.

- **Processors and `beforeSend`** — each returns the event to pass on, or `null` to drop it; one that
  throws drops the event silently. `addProcessor` appends, so processors accumulate, while
  `beforeSend` replaces, so there is one hook, and it runs after every processor. Redaction runs
  first, so both see redacted data.
- **`ignoreErrors` matching** — a string matches as a substring and a `RegExp` is tested as it is,
  with `lastIndex` reset to 0 first. A pattern is tried against the top exception's
  `"<type>: <message>"` and against its message alone; for `captureMessage` it is tried against the
  message text. It runs after normalization and before redaction.
- **Deduplication key** — an event is compared only with the last event that passed deduplication,
  with no time window. Two events are identical when their fingerprints are equal, or when their
  message, top exception type and message, and stack frames are equal. Attributes are not part of
  the key, so the same error raised for two users collapses to one event, and two identical
  `captureMessage` calls collapse too. Deduplication runs after the processors, so one that rewrites
  the message changes the key.
- **Unhandled events** — an event whose `mechanism.handled` is `false` skips deduplication and the
  rate limit and takes no token, so a burst of handled errors never drops the
  `uncaughtException` report that follows. It still passes the gate, sampling, `ignoreErrors`, the
  processors and `beforeSend`.
- **The rate limit protects the backend, not the client** — an event that finds the bucket empty is
  dropped, but only after it has paid for normalization, enrichment, redaction, the processors and
  `beforeSend`. The bucket refills lazily from each event's `time`; there is no timer.

To deliver every handled event, call `dedupe(false)` and `rateLimit(false)`.

### Scopes

An Error Event's `attributes` carry the ambient `Scope` chain beneath the call's own attributes: the
attributes of every Scope between the current one and the root, the innermost winning, then the
`attributes` passed to the capture call, which win on a shared key. Each side is normalized
separately and bounded by the reporter's limits (`maxBreadth`, 100 entries by default). The Resource
(see Release, environment and runtime context for its keys) is not copied into events; a `Transport`
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

- **`Scope.setResource(partial)`** merges the Resource keys into the realm's one root, in
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
Resource throws, the event is enabled by the environment gate and delivered with a Resource whose
keys are all `undefined`; the logger drops the record on the same throw, since an event is worth
more than its Resource. In
the browser the synchronous-stack carrier loses the Scope after an `await` (ADR-0006).

### Release, environment and runtime context

A release, an environment and a build distinguisher are Resource keys, set once with
`Scope.setResource`; none is a builder option, so the logger and every reporter read the same values
(ADR-0016):

| Bugsnag / Sentry | Resource key | Vocabulary |
|------------------|--------------|------------|
| `release` | `service.version` | OpenTelemetry |
| `environment` | `deployment.environment.name` | OpenTelemetry |
| `dist` | `service.dist` | vipengele extension |
| `enabledReleaseStages` | `builder.enabledEnvironments(list)`, checked against `deployment.environment.name` | |

```ts
import { createConsoleTransport, createReporter, Scope } from "@vipengele/ts-core-observability/errors";

Scope.setResource({
  "service.name": "checkout",
  "service.version": "1.4.2",
  "service.dist": "2026-10-11.3",
  "deployment.environment.name": "production",
});

const reporter = createReporter((builder) =>
  builder.transport(createConsoleTransport()).enabledEnvironments(["production", "staging"]),
);
```

**Detected keys** — `createReporter` detects the runtime once, synchronously and without
dependencies, and fills these Resource keys:

| Key | Vocabulary |
|-----|------------|
| `process.runtime.name` | OpenTelemetry |
| `process.runtime.version` | OpenTelemetry |
| `os.type` | OpenTelemetry |
| `os.version` | OpenTelemetry |
| `browser.name` | vipengele extension |
| `browser.version` | vipengele extension |
| `device.type` | vipengele extension |

Together with `service.name`, `service.version`, `service.dist` and `deployment.environment.name`
these are the eleven reserved Resource keys, all present in every `Resource` a `Transport` receives
and none settable by a descendant Scope.

- **Node, Bun, Deno and edge runtimes** — `process.runtime.version` is the runtime's own version
  without a leading `v` (`Bun.version`, `Deno.version.deno`; their `process.version` names the Node
  release they imitate). `os.type` is `process.platform` in OpenTelemetry's lowercase vocabulary
  (`win32` is `windows`, `sunos` is `solaris`; `darwin`, `linux` and the other Node platform names
  pass through). `os.version` is never set there.
- **Browsers and workers** — `process` is never read. The browser, OS and device keys come from
  `navigator.userAgent`, with the synchronous `navigator.userAgentData` hints outranking the string
  where present. `os.type` is `windows`, `darwin`, `linux`, `ios`, `android` or `chromeos`;
  `device.type` is `mobile`, `tablet` or `desktop`.
- **Best-effort** — what a user agent cannot tell is not guessed at. Chromium and Safari freeze the OS
  version they report (macOS is always `10.15.7`, Windows 10 and 11 are both `10`). iPadOS sends a Mac
  user agent unless `navigator.maxTouchPoints` indicates touch. "Request Desktop Site" hides a mobile
  device. A spoofed user agent is reported as claimed.
- **Unset keys only** — detection writes a key only when the Resource holds no value for it, so an
  explicit `Scope.setResource` wins whether it runs before `createReporter` or after. A second
  reporter fills only the keys still unset. A throw in detection leaves the Resource as it was and the
  reporter working.
- **Reporter-only** — an application that only logs creates no reporter and gets no detected values.
  There is no opt-out, and the detector is not exported; set a better value with `Scope.setResource`.

**The environment gate** — `builder.enabledEnvironments(list)` is an allow-list checked first,
against the Resource read at capture. An event whose `deployment.environment.name` the list does not
hold is dropped before it is normalized, and the capture still returns its event `id`.

- **Unset is enabled** — an unset environment is enabled, and so is a Resource whose read threw. The
  empty string is a set environment, enabled only when the list holds it.
- **Validation** — an empty list, a value that is not an array, or a non-string entry throws
  `ReporterConfigError` and leaves the builder as it was. This differs from Bugsnag, where
  `enabledReleaseStages: []` reports nowhere; to report nowhere, configure no transport.
- **The gate drops the report, never the exit** — with `globalHandlers` and an `"exit"` policy, an
  uncaught error in a disabled environment is still written to `console.error`, the transport is
  still flushed for up to `flushTimeoutMs`, and the process still exits with code `1`.

### Limits

`builder.limits(options)` bounds what one event carries. Any subset of the options may be set; each
is a positive integer or `Infinity`:

| Option | Bounds | Default |
|--------|--------|---------|
| `maxDepth` | nesting levels of an attribute or error `data` value | `6` |
| `maxBreadth` | entries per object or array, and the `frames` of each exception link | `100` |
| `maxStringLength` | UTF-16 code units per string, and the event `message` | `8192` |
| `maxLinks` | links followed through `cause` and `errors` | `5` |
| `maxErrors` | entries of one link's `errors` | `100` |

```ts
const reporter = createReporter((builder) => builder.limits({ maxStringLength: 2048, maxBreadth: 50 }));
```

- **Validation** — any other value, or a `limits` argument that is not an object, throws
  `ReporterConfigError` (code `observability.errors.config`, checked with `isReporterConfigError`)
  and leaves the builder as it was. An option left `undefined` is not set.
- **Replacement** — a later call replaces only the options it sets; the rest keep their earlier value
  or the default.
- **What is bounded** — the merged `attributes`, the serialized exception chain, the event `message`
  and each link's `frames`. A `frames` list keeps its first `maxBreadth` frames, the throw site
  first, with no marker entry.
- **The cut is marked, so the result exceeds the limit** — a cut string is the first
  `maxStringLength` code units plus the `"…[truncated]"` suffix, and a cut object or array holds
  `maxBreadth` entries plus one marker entry. Frames are the exception: exactly `maxBreadth`, no
  marker.
- **Units** — levels, entries per container and code units per string. There is no byte limit and no
  total over an event; the transport owns wire limits (ADR-0010).
- **The logger** has the same defaults for its records but no builder option to change them. Neither
  the logger nor the reporter scans free text for secrets; see Redaction.

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
