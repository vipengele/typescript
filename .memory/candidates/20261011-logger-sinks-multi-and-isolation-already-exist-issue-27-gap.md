---
about: for issue #27 the logger already has multi-sink, per-sink isolation and hard-wired redaction; the gaps are processors/filters, sink lifecycle, and the ADR-0005 protocol-mismatch warning
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/builder.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/slots.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
---
State of the logger before #27 work (read at HEAD, 2026-10-11).

- Multiple sinks: `LoggingBuilder.addSink` (`logger/builder.ts:56`, impl `:117`) appends; `build()` freezes the list (`:148`) and rejects non-objects (`:140-143`). Sinks are global to the provider, not per category and with no per-sink level (`EmitSettings.sinks`, `record.ts:556`). `configure` replaces sinks (`provider.ts:344-346`). Sinks are never published to a globalThis slot (`logging.ts:47`, only the level table is).
- `Sink` is `{ write(record, resource): void }` only (`record.ts:520-522`), no flush/close; the `(record, resource)` arity is part of the `provider.v1` protocol.
- Isolation: `emitRecord` guards each `write` separately (`emit.ts:276-282`), reports to `settings.onSinkError` through a guard that swallows its own throws (`emit.ts:226-232`); all sinks tried. Record build (clock, normalize, serialize, redact) plus `resource()` are one guard that drops the record SILENTLY and does not call `onSinkError` (`emit.ts:267-274`).
- "Once" today: reported once per failing sink per record, EVERY record (no dedup): `record.ts:572-574`, README "reported once per failing sink per record" (README ~120), test `logging.test.ts:306` "are reported every time, not once", `emit.test.ts:634`. Default provider/`createProvider` onSinkError warns `A log sink threw while writing a record: <name: message>` via the per-copy warn target (`logging.ts:39-42`, `:60`, `:101`). A bare `createLoggerProvider` with no option drops failures silently (`provider.ts:413`; doc `:331-334`). `onSinkError(error: unknown): void`: no sink identity, no record passed.
- Redaction is hard-wired into record construction, not a processor: `createRecord` calls `redactAttributes`/`redactError` with `settings.redaction` (`emit.ts:211-221`); `builder.redaction(policy|null)` (`builder.ts:68`), default `defaultRedaction()` (`builder.ts:150`, settings.ts) = secretKeys. Redaction therefore happens before any sink, once, and the record is `freezeDeep`ed (`emit.ts:222`) so sinks cannot mutate it for the next sink.
- No processor/filter concept in the logger (grep `processor|filter` in src/logger: none). Reporter models them in `errors/pipeline.ts:32-35`: `Processor = (event) => ErrorEvent` (sync, cannot return null, a throw drops the event), `Filter = (event) => boolean` (false drops, throw drops); order redaction -> processors (reduce) -> filters (every) -> transport (`:194-200`); whole capture in one try/catch, silent (`:213-224`). BUT the reporter has no public API for them: `createReporter` hard-codes `processors: [], filters: []` (`errors/reporter.ts:77`), and ReporterBuilder has no addProcessor. So processors/filters exist as plumbing only.
- ADR-0005 (`docs/adr/0005-...md:52-55`): each copy registers its protocol version and a copy finding another protocol emits one `warn`; the ADR assigns that warning to #27 and says the level-only logger does not emit it. Not implemented in `slots.ts` (only `getOrCreateDefaultProvider`, `slots.ts:~167`).
- CONTEXT.md defines Sink (`CONTEXT.md:83-85`, "may hold several") but has no "Processor" or "Filter" term; the reporter's Processor/Filter are code-only, so a logger processor needs a glossary entry.
- No reference to "hatua" anywhere in the repo or memory (`grep -rli hatua`: 0 hits).
