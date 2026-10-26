---
about: "The reporter pipeline already has Processor and Filter stages, but createReporter hard-codes both to [] with no builder API, and no ADR places sampling, dedupe or rate limiting in Reporter vs Transport"
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/builder.ts
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
  - CONTEXT.md
---
- `pipeline.ts:32,35` define `Processor = (event) => ErrorEvent` and `Filter = (event) => boolean`; `deliver` (`pipeline.ts:194-202`) runs redaction, processors via reduce, filters via `every`, then `transport.send`. Any throw is swallowed by `createCapture`'s try/catch (`pipeline.ts:220`), so the event is dropped silently and the id is still returned (fail-closed, but NOT reported anywhere: no onError hook, unlike the logger's `onSinkError`, ADR-0017).
- `reporter.ts:474` passes `processors: []`, `filters: []`; `ReporterSettings` (`builder.ts:234`) has no such field. The stages are unreachable from public API.
- Processors are sync and cannot return null (null-drop is the Filter's job). ADR-0017 "Considered options" says the Reporter has a separate Processor/Filter pair and the logger chose to merge them.
- No ADR names the five stages or fixes their order; the order is only in the `createCapture` docstring (`pipeline.ts:204-211`). ADR-0007:159 fixes redaction between enrich and processors. ADR-0016 fixes that the environment gate runs first.
- ADR-0010 and `transport.ts:501-503` say "the decision to drop belong[s] to the transport", but that sentence is about delivery (batching/retry/queue). No ADR or CONTEXT.md entry decides where sampling/dedupe/rate-limit goes. ADR-0007:165 only says `id` exists from capture "so deduplication ... refer to the same event".
- Randomness: only `event-id.ts` uses `crypto.getRandomValues`; only precedent for an injected random is `resilience/src/retry/backoff.ts:60` (`random: () => number = Math.random`). Time: `Clock` injected via `ReporterBuilder#clock` (`builder.ts:294`), but `Clock` is a read-only function; `Scheduler` has only `sleep`.
Established by reading the files above and grepping docs/adr, CONTEXT.md and the observability README for dedup/sampl/rate/beforeSend (0 relevant hits).
