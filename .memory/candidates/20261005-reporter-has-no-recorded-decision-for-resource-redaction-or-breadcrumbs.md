---
about: the reporter pipeline has no recorded decision for how a Transport gets the Resource, for public processors/filters, for default redaction, or for reading breadcrumbs; the ADR text is aspirational there
saw:
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
  - CONTEXT.md
  - source/core/packages/observability/src/errors/transport.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/observability/src/logger/settings.ts
---
Found by reading the ADRs against the code (no memory note covered it).

Resource to Transport:
- ADR-0007 "The Resource is sent once" (lines 127-132) says "Transports attach the Resource once per payload, and Sinks receive it alongside each record". Only the Sink half is built (`logging.ts:78` passes `resource: Scope.resource`). `Transport.send(event)` (`transport.ts:10`) takes only the event; ADR-0010 (lines 6-11) fixes the interface as `send(event)/flush/close` and never mentions the Resource. `grep -rn resource errors/` hits only comments in `pipeline.ts:71`, `event.ts:20` and a test. No ADR, rule or note chooses between a second `send` arg, a construction-time accessor, or the transport reading `Scope.resource()` itself. `Scope.resource()` (`common/src/scope/scope.ts:56`) is a public, frozen, per-call snapshot, so a transport can call it unaided. Both built-in transports ignore it (`console-transport.ts:28-39`).
- Constraint: root is built lazily from all-undefined UNKNOWN_RESOURCE (`root.ts:72,215`); `createScopeTree` has no non-test caller, so any option yields undefined Resource keys today.

Redaction / processors:
- `reporter.ts:127` hardcodes `processors: [], filters: []`; `ReporterBuilder` (`builder.ts`) has transport/clock/projectRoot/add only. `Processor = (event) => event` (throw drops), `Filter = (event) => boolean` (`pipeline.ts:176,179`) are exported from pipeline.ts but not from `errors/index.ts`. No ADR defines them beyond the five-stage names; no ADR says the reporter redacts. ADR-0007:116 "Redaction runs at the same point, before any Sink" sits under the Log Record normalization section and covers Sinks only. The logger defaults redaction to `secretKeys` (`logger/settings.ts:61-70`); the reporter has no redaction at all, so Error Event attributes/exception data/messages reach a Transport unredacted. CONTEXT.md "JSON-safe" says every value a "Sink or Transport receives" is JSON-safe, but says nothing on redaction for Transports.

setUser/setTag/setContext:
- ADR-0007:145-147 says `Scope.setUser` writes `user.*`, ADR-0006:13 says "A single-page app's `setUser` after login". `Scope` exports only current/propagate/inherit/isolated/resource/useCarrier (`scope.ts` end); `grep setUser` finds only those two ADR lines. No rationale recorded for or against helpers; `Scope.current().set("user.id", ...)` is what exists. CONTEXT.md bans "context" for Scope (Avoid: context, MDC, request context) and Resource's Avoid is "global tags, global context". Error Event is described as having "its scope's context" (CONTEXT.md) despite that. Named contexts would be namespaced attribute keys (ADR-0007: no separate tags/extra/user).

Breadcrumbs:
- `ErrorEvent` has no `breadcrumbs` field (`event.ts:309-328`), though ADR-0007:48 still shows one marked "superseded by ADR-0006". Nothing fills a trail; `grep -i breadcrumb` in observability/src and common/src hits only `root.ts`. ADR-0006:89-93: Scope's public surface is tag/get/set, ancestry not public, `snapshot(scope)` (`root.ts:169`) is the single internal exception and it flattens attributes only and never returns tags. A trail needs a new internal walker next to the `Symbol.for` PARENT/ATTRIBUTES slots in `root.ts` (they are module-private; other package copies read the same slots), and a decision on the event field's shape (the ADR's `Breadcrumb` interface with time/category/level is the superseded design).

Scope from errors entry:
- No ADR option considers re-exporting Scope from `@vipengele/ts-core-observability/errors`. `errors/index.ts` re-exports only `Clock` from common; `pipeline.ts:11` imports `@vipengele/ts-core-common/scope` directly. The umbrella `@vipengele/ts` re-exports `Scope` (`source/ts/packages/ts/src/index.ts:14`) and does not depend on observability. Observability has `common` as a `workspace:*` dependency (`package.json:56`), so a re-export would not add a dependency; the dual-copy rationale (ADR-0006:56-58, globalThis slots) means a re-exported Scope still reaches the same tree.
