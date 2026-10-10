# @vipengele/ts-core-observability

The logger (`./logger`) and the error reporter (`./errors`), two entry points of one package.
Run commands from `source/core` (`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`,
`pnpm format:check`).

## Logger emit path (`src/logger`)

- `logger.ts` checks the level, then hands the call to `emitRecord` (`emit.ts`) with the
  `EmitSettings` (`record.ts`) read on every call: `sinks`, `clock`, `redaction`, `resource`,
  `onSinkError`. `sinks`/`clock`/`redaction` are builder state (`builder.ts`); `resource` and
  `onSinkError` are provider options wired from `logging.ts` (`logger.ts` cannot import it).
- With no sink, `emitRecord` reads nothing (not the clock, attributes or error).
- Record building (clock, `normalizeAttributes`, `serializeError`, redaction, `resource()`) runs in
  one guard: a throw drops the record silently. Each `Sink.write` has its own guard that reports to
  `onSinkError`; every sink is tried and the caller never sees a throw.
- Redaction (`secretKeys` by default, `null` disables) covers `attributes` and every link of the
  error chain, including the JSON `message` of a synthetic link; it runs unbounded over input
  already bounded by normalization. The record message and an `Error`'s `message`/`stack` are not
  scanned. The finished record is deeply frozen and shared by all sinks.
- `configure` replaces the sinks rather than appending; a `createProvider` provider shares none
  with the default one. Level table and default provider live in `globalThis` slots (ADR-0005).

## Shared redaction helpers (`src/redaction.ts`)

- `redactAttributes` and `redactError` are used by the logger's emit path and the reporter's
  pipeline. Both run unbounded over input already bounded by normalization; a link's `code` goes
  through the policy under the key `code`, and a synthetic link's JSON `message` is parsed,
  redacted and rewritten, or replaced whole when it does not parse.

## Reporter pipeline (`src/errors/pipeline.ts`)

- `enrich` merges `snapshot(Scope.current())` beneath the call's own attributes (the call wins on a
  shared key). Each side is normalized separately, and a throw while reading the scope yields no scope
  attributes rather than dropping the event. The Resource is never copied into events.
- Stages: normalize, enrich, redaction, processors, filters, transport. Redaction applies
  `builder.redaction(policy | null)` (default `secretKeys`, `null` disables) to the merged
  `attributes`, `mechanism.data` and every link of the exception chain; never the event `message`,
  `stack` or `frames`. A throwing policy drops the event silently, as the logger drops a record.
- `builder.limits({ maxDepth, maxBreadth, maxStringLength, maxLinks, maxErrors })` is validated at
  the call (`ReporterConfigError`, builder left unchanged) and merges per option. The pipeline
  passes it to `normalizeAttributes` and `serializeError`, cuts the event `message` at
  `maxStringLength` and each link's `frames` at `maxBreadth` (default 100, throw site first, no
  marker entry), so the limits also bound what redaction and processors see.
- `Transport.send(event, resource)`: `eventResource()` reads `Scope.resource()` once per event at
  delivery inside a guard. A throw yields a Resource with all four keys `undefined` and the event
  still goes out — asymmetric with the logger, which drops the record, because an event is worth
  more than its Resource. `send` stays synchronous and non-throwing (ADR-0010).
- `createTestTransport` records `events` and `resources` as parallel arrays; the console transport
  does not print the Resource.
- `./errors` re-exports `Scope` and the `Resource`, `ScopeAttributes`, `ScopeUser` types, not
  `snapshot`. `Scope.setUser`/`setTag`/`setContext` write flat dotted attribute keys, so an event has
  no `tags`, `user` or `contexts` field. `secretKeys` splits keys on every non-alphanumeric
  character, so `session.id` from `Scope.setContext("session", { id })` is masked by default.
