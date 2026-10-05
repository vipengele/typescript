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

## Reporter enrich stage (`src/errors/pipeline.ts`)

- `enrich` merges `snapshot(Scope.current())` beneath the call's own attributes (the call wins on a
  shared key). Each side is normalized separately, and a throw while reading the scope yields no scope
  attributes rather than dropping the event. The Resource is never copied into events.
