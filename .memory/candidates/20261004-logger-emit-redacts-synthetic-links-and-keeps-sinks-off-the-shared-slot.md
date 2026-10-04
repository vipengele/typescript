---
about: how the logger emit path redacts non-Error thrown values, why redact runs unbounded there, and where sinks, clock, redaction and resource live relative to the shared slots
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/settings.ts
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/common/src/serialization/serialize-error.ts
---

- `serializeError` gives a thrown value that is not an `Error` (top level, a `cause`, or an `errors`
  entry) a `synthetic: true` link with no `data`: its JSON text is the `message`. Redacting only
  `data` therefore leaks `{ password }`-style values. `emit.ts` (`redactSyntheticMessage`) parses a
  synthetic message that opens with `{` or `[`, redacts the parsed value and re-stringifies it; text
  `serializeError` cut at its 8192-character bound no longer parses and the whole message is replaced
  by a marker. A real `Error`'s `message` and `stack` are deliberately not scanned.
- `redact` runs with `maxDepth`, `maxBreadth` and `maxStringLength` at `Infinity` in `emit.ts`:
  `normalizeAttributes` and `serializeError` have already bounded the input, and a second pass under
  the default limits would cut their own markers (a `"…"` breadth key, a `"…[truncated]"` suffix).
  `redact` is not run before `serializeError` because it drops `toJSON`, turns class instances into
  plain objects and throws on a revoked Proxy, where `serializeError` never throws.
- Sinks, clock and redaction are builder state (`LoggingBuild`), replaced whole by every `configure`;
  `settings.ts` carries them on `LoggingSettings` but `logging.ts` still publishes only
  `settings.levels` to the shared levels slot, so sinks never cross package copies. `reset()` restores
  the default output too, dropping sinks. `resource` and `onSinkError` are provider options wired in
  `logging.ts` (`logger.ts` cannot import `logging.ts`: logging, provider, logger is a cycle).
- `onSinkError` reports through the copy-local warn target (`setWarnTarget`), so a Logger from another
  copy's default provider reports through the creating copy's target. A record-construction failure
  (clock, redaction, resource) drops the record silently; only `Sink.write` throws are reported.
- The default `secretKeys` redaction is referenced only inside `defaultRedaction()` in `settings.ts`,
  never at module scope, to keep `sideEffects: false`; `settings.node.test.ts` is Node-only because
  counting reads of a mocked module's export does not work under Chromium.
- A sink whose `write` returns a rejecting promise produces an unobserved rejection: `emit.ts` neither
  awaits nor observes the result.
