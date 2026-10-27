# @vipengele/ts-core-observability

The logger (`./logger`) and the error reporter (`./errors`), two entry points of one package.
Run commands from `source/core` (`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`,
`pnpm format:check`).

## Logger emit path (`src/logger`)

- `logger.ts` checks the level, then hands the call to `emitRecord` (`emit.ts`) with the
  `EmitSettings` (`record.ts`) read on every call: `sinks`, `clock`, `redaction`, `resource`,
  `onSinkError`. `sinks`/`clock`/`redaction` are builder state (`builder.ts`); `resource` and
  `onSinkError` are provider options wired from `logging.ts` (`logger.ts` cannot import it).
- With no sink, `emitRecord` reads nothing (not the clock, attributes, thunk or error). A disabled
  call stops at the level check: the Logger allocates nothing and runs nothing.
- `attributes` of an emit method is `AttributesInput | AttributesThunk` (`logger.ts`), dispatched on
  `typeof === "function"` of that argument alone; in `warn`/`error`/`fatal` a function in the `error`
  position is an error value. `createRecord` runs a per-call thunk once per record through
  `evaluateAttributes` (`emit.ts`), before normalization and redaction. A throw, a re-entrant call or
  a non-record result (string, array, `null`, `undefined`) gives `{}`; nothing reaches `onSinkError`.
  The re-entrancy flag is module-level, so it is global within one copy of the package and not shared
  across copies (ADR-0019).
- Hot-path proof: `hot-path.test.ts` (both runtimes) asserts nothing runs for a disabled or sinkless
  call; `hot-path.node.test.ts` (Node only) measures heap growth of disabled calls with a hoisted
  thunk, discarding any attempt a GC ran in (observed through `PerformanceObserver`). There is no
  bench: `src/**` counts toward the coverage gate and ships in the build output.
- Level layers, lowest first: defaults, builder, overrides, environment (`VPG_LOG`). The environment
  layer is read once per provider, lazily (`environment-source.ts`), survives `clearDefaults()` and
  `reset()`, and only `ignoreEnvironment()` drops it. Every `Logger` call checks the level, then calls
  `emitRecord`; the console handle's confirmation (`console-handle.ts`) is the one internal caller
  that skips the level check, through the provider's `confirm` path, and with no sink it goes to the
  provider's `warn` option instead.
- `build()` is side-effect free: it reads browser storage but never writes it. A stored spec found
  unreadable is cleared only after the provider commits the build, so a rejected `configure` clears
  nothing. The published level table is replaced whole and frozen, never mutated.
- `Logger#with(attributes)` returns a frozen Logger whose closure holds an ordered list of binding
  layers (`BindingLayer`, `emit.ts`); `emitRecord` takes them as its last argument. A static input is
  normalized and deeply frozen at `with()` time (`{}` returns the same Logger; any thunk makes a new
  one). A thunk makes a lazy layer: evaluated at the first record that passes the level check with a
  sink, normalized, frozen and reused; a throw gives `{}` for that record and is not memoized. A
  child carries an evaluated parent layer as a fixed value, and an unevaluated one as a fresh cell
  that evaluates at the child's own first record, so parent and child can disagree. Layers merge in
  order, so `with(thunk).with({ x })` lets the static layer win. Consecutive static layers (and a
  static layer after an already-evaluated thunk) merge into one fixed layer at `with()` time; a
  static layer after an unevaluated thunk stays its own layer. A child shares the parent's level
  resolver and `emit` settings getter, so live level changes reach it.
- Record building (clock, Scope read, `normalizeAttributes`, `serializeError`, redaction,
  `resource()`) runs in one guard: a throw drops the record silently. The Scope read
  (`normalizeAttributes(snapshot(Scope.current()))`) has its own inner guard yielding `{}`, so a
  throwing Scope never drops the record. Attributes merge through `mergeAttributes`
  (`src/merge-attributes.ts`, shared with the reporter) as Scope < bindings < call, then are
  redacted as one record. Each `Sink.write` has its own guard that reports to
  `onSinkError(error, source)`; every sink is tried and the caller never sees a throw.
- Processors (`LogProcessor`: record in, record or `null` out): `builder.addProcessor` runs ahead of
  every sink, `addSink(sink, { processors })` after the global chain, ahead of that sink. A throw, a
  malformed return or a cyclic attribute fails closed: a global processor drops the record for all
  sinks, a per-sink one for that sink. Returned attributes are re-normalized and the result frozen.
  `build()` throws `LoggingConfigError` for invalid processors or options. `redactionProcessor(policy)`
  (`redaction-processor.ts`) is the opt-in per-sink extra (ADR-0017).
- The default warn path (`sinkErrorsOncePerSource: true`) warns once per sink or processor per
  configuration (identity `WeakSet`; `configure` and `reset` clear it, `override` does not); a
  host-supplied `onSinkError` receives every failure. A copy that finds another
  `vipengele.logger.provider.<non-v1>` slot warns once, when its default provider is first resolved.
- Redaction is the fixed first stage, before any processor. It (`secretKeys` by default, `null` disables) covers `attributes` and every link of the
  error chain, including the JSON `message` of a synthetic link; it runs unbounded over input
  already bounded by normalization. The record message and an `Error`'s `message`/`stack` are not
  scanned. The finished record is deeply frozen and shared by all sinks.
- `configure` replaces the sinks rather than appending; a `createProvider` provider shares none
  with the default one. Level table and default provider live in `globalThis` slots (ADR-0005).

## Console sink and formatters (`src/logger`)

- A `Formatter` (`formatter.ts`) returns the argument list of one console call. The sink owns
  routing: `createConsoleSink` (`console-sink.ts`) calls `console[consoleMethodFor(level)](...args)`,
  so a formatter never picks a method.
- The first argument is a console format string. JSON lines and ANSI return `["%s", text]`; the
  browser formatter escapes `%` as `%%` in the `%c` format string it builds and passes message,
  attributes and error as later arguments. A formatter must not put user text in the first slot.
- With no `formatter` option, `formatters/select.ts` reads `detectCapability`: `consoleStyling`
  gives browser, else `ansiColour` gives ANSI, else JSON lines (Deno has both, styling wins). It is
  resolved once at creation. Without an injected `source`, `detectCapability` memoises per module
  copy, so tests inject a `source` (or a `formatter`) to control the outcome; a bare call is only
  asserted to return one of the three formatters.
- `createTestSink` (`test-sink.ts`) is the in-memory sink: live `records`/`resources` arrays plus
  `find` and `clear`; it stores the shared frozen records by reference.
- `ConsoleLike` has no `log`. The routing table in `formatter.ts` is a private copy that mirrors
  the errors console transport; ADR-0007 "Levels" is the authority. `./logger` and `./errors` must
  not import each other.
- `write` has no try/catch: a throwing formatter or console reaches `onSinkError`. `time` is the
  epoch-ms number in JSON lines and UTC ISO text in the ANSI and browser formatters (ADR-0018).

## Shared redaction helpers (`src/redaction.ts`)

- `redactAttributes` and `redactError` are used by the logger's emit path and the reporter's
  pipeline. Both run unbounded over input already bounded by normalization; a link's `code` goes
  through the policy under the key `code`, and a synthetic link's JSON `message` is parsed,
  redacted and rewritten, or replaced whole when it does not parse.

## Reporter pipeline (`src/errors/pipeline.ts`)

- `enrich` merges `snapshot(Scope.current())` beneath the call's own attributes (the call wins on a
  shared key). Each side is normalized separately, and a throw while reading the scope yields no scope
  attributes rather than dropping the event. The Resource is never copied into events.
- Stages: gate, `sampleRate`, normalize, `ignoreErrors`, enrich, redaction, processors, `beforeSend`,
  dedupe, rate limit, transport (ADR-0020). The Reporter owns policy drops and the Transport delivery
  drops; every drop still returns the id. `sampleRate` 1, `ignoreErrors` `[]`, `dedupe` on and
  `rateLimit` 60 burst / 60 per minute are the defaults; dedupe compares only with the last event
  that passed (no window, attributes excluded) and `mechanism.handled === false` bypasses dedupe and
  the rate limit. `addProcessor` appends, `beforeSend` replaces. Redaction applies
  `builder.redaction(policy | null)` (default `secretKeys`, `null` disables) to the merged
  `attributes`, `mechanism.data` and every link of the exception chain; never the event `message`,
  `stack` or `frames`. A throwing policy drops the event silently, as the logger drops a record.
- `builder.limits({ maxDepth, maxBreadth, maxStringLength, maxLinks, maxErrors })` is validated at
  the call (`ReporterConfigError`, builder left unchanged) and merges per option. The pipeline
  passes it to `normalizeAttributes` and `serializeError`, cuts the event `message` at
  `maxStringLength` and each link's `frames` at `maxBreadth` (default 100, throw site first, no
  marker entry), so the limits also bound what redaction and processors see.
- `Transport.send(event, resource)`: `eventResource()` reads `Scope.resource()` once per event,
  before any stage, inside a guard; the same Resource gates the event and is handed to `send`. A throw
  yields a Resource with all eleven keys `undefined` and the event still goes out — asymmetric with the
  logger, which drops the record, because an event is worth more than its Resource. `send` stays
  synchronous and non-throwing (ADR-0010).
- `builder.enabledEnvironments(list)` is an allow-list checked first in capture, before normalize: an
  event whose `deployment.environment.name` is set and not in the list is dropped. An unset
  environment (including an unreadable Resource) is enabled; no list enables every environment.
- `createReporter` calls `fillRuntimeContext` (`reporter.ts`), which writes the keys
  `detectRuntimeContext` (`runtime-context.ts`, unexported, best effort) finds into Resource keys that
  hold no value; a key already set is never overwritten and a throw is swallowed (ADR-0016).
- `createTestTransport` records `events` and `resources` as parallel arrays; the console transport
  does not print the Resource.
- `./errors` re-exports `Scope` and the `Resource`, `ScopeAttributes`, `ScopeUser` types, not
  `snapshot`. `Scope.setUser`/`setTag`/`setContext` write flat dotted attribute keys, so an event has
  no `tags`, `user` or `contexts` field. `secretKeys` splits keys on every non-alphanumeric
  character, so `session.id` from `Scope.setContext("session", { id })` is masked by default.
