---
about: the reporter hands the Resource to a Transport as send's second argument and redacts events by default, but its processors and filters are still not configurable and nothing reads the breadcrumb trail into an event
saw:
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - source/core/packages/observability/src/errors/transport.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/index.ts
  - source/core/packages/observability/src/redaction.ts
  - source/core/packages/common/src/scope/scope.ts
---
Decided (ADR-0007, ADR-0010, ADR-0006):

- `Transport.send(event, resource)` (`transport.ts`): `pipeline.ts`'s `eventResource()` reads `Scope.resource()` once per event at delivery inside a try/catch; a throw yields a Resource whose four keys are `undefined` and the event still goes out. The logger drops the record on the same throw; the asymmetry is recorded in ADR-0010.
- Redaction is a pipeline stage after enrich and before processors (`redactEvent` in `pipeline.ts`): `attributes`, `mechanism.data` and every `cause`/`errors` link's `code`, `data` and synthetic JSON `message`; never the event `message`, `stack` or `frames`. `ReporterBuilder.redaction(policy | null)` defaults to `secretKeys` read at `build()`. A throwing policy throws inside `createCapture`'s guard, so the event is dropped and the id is still returned. The helpers are shared with the logger in `observability/src/redaction.ts`.
- `secretKeys` splits keys on every non-alphanumeric character, so the flat dotted keys `Scope.setContext("session", { id })` and `Scope.setTag("sessionId", ...)` write are masked by default (ADR-0006).
- `Scope.setUser`/`setTag`/`setContext` exist in `common/src/scope/scope.ts` and write flat dotted attribute keys; `ErrorEvent` has no `tags`/`user`/`contexts` field. `./errors` (`errors/index.ts`) re-exports `Scope` and the `Resource`, `ScopeAttributes` and `ScopeUser` types, not `snapshot`.

Still open:

- `reporter.ts` passes `processors: [], filters: []` to `createCapture`; `ReporterBuilder` has `transport`, `clock`, `projectRoot`, `redaction` and `add`, no processor or filter method, and `Processor`/`Filter` (`pipeline.ts`) are not exported from `errors/index.ts`.
- `ErrorEvent` has no `breadcrumbs` field and nothing reads the tagged-ancestor trail into an event; ADR-0007's type block still shows a `Breadcrumb[]` field marked superseded by ADR-0006. A trail needs a walker next to the `Symbol.for` parent and attribute slots in `common/src/scope/root.ts`, which are module-private.
