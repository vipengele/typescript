---
about: the logger has no formatter concept and no default sink; ADRs 0004/0007 and the README already name formatters as a future separate piece a consumer passes in
saw:
  - source/core/packages/observability/README.md
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/settings.ts
  - source/core/packages/observability/src/logger/record.ts
  - CONTEXT.md
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
Found while planning issue #28 (formatters).

- No `Formatter` type or glossary term. `grep -ril formatter` over CONTEXT.md, docs/, source/: CONTEXT.md:81 only ("a record is not text until a formatter makes it so"); ADR-0007:92 ("the console formatter ... needs" the structured error tree) and :99 (presentational kinds are attributes a formatter styles); ADR-0004:54 (formatters/exporters are "separate classes a consumer passes in, not code the default path references"); README.md:194 ("What the logger does not have: formatters ... A sink formats a record itself").
- No default sink: `settings.ts:70-74` default build has `sinks: []`; `provider.ts:91` doc says "no sinks". With no sink a record that passes the level check goes nowhere. The only console use in the logger is `console.warn` for spec issues and, when no `setWarnTarget` is injected, sink failures (`logging.ts:32-43`). `createProvider` with no `onSinkError` option uses a no-op (`provider.ts:144-146`).
- `LogRecord` (`record.ts`): `time` (epoch ms number with sub-ms fraction, `Clock = () => number`, common `time/clock.ts`), `level`, `category`, `message`, `attributes` (normalized, redacted, deep-frozen), optional `error: SerializedError`. No trace/span ids on the record. `Sink.write(record, resource)` returns void, return ignored.
- Attributes are already JSON-safe: `normalizeAttributes` turns bigint into "<n>n", Date into ISO, Map/Set into object/array (`normalize-attributes.ts:27`); `createRecord` in `emit.ts:53-77` deep-freezes. A JSON-lines sink can `JSON.stringify` without a replacer.
- Level to console method precedent: `errors/transports/console-transport.ts` maps error/fatal -> error, warn -> warn, info -> info, trace/debug -> debug, never `console.trace` (ADR-0007 "Levels"). Its `ConsoleLike` and `methodFor` are private to that file; logger would need its own copy or a shared module (neither entry imports the other today).
