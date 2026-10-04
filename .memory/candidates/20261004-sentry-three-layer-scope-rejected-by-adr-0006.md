---
about: ADR-0006/0007 reject Sentry's global/isolation/current layers and separate tags/user/extra; Scope is attributes-only (tag = breadcrumb), and neither the logger nor the reporter reads Scope yet
saw:
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/scope/scope.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
---
Evidence (found while planning issue #40 "Scopes"):

- ADR-0006 "Considered options" rejects "Sentry's global -> isolation -> current layers" (three concepts with different mutability where one tree suffices). Root = global/Resource (frozen, `root.ts` createScopeTree), `Scope.isolated` (`scope.ts:47`) = isolation, `inherit` (`scope.ts:36`) = current. ADR-0006 also names `setUser` as landing on the default scope.
- ADR-0007 "What an Error Event adds": "No separate `tags`, `extra` or `user`... everything is `attributes`, and `Scope.setUser` writes OpenTelemetry's `user.*` keys". ErrorEvent (`event.ts:116`) has only `attributes`. Its `breadcrumbs` field is superseded: a scope's `tag` is its Breadcrumb.
- Scope's public surface is `tag`, `get`, `set` only (`root.ts:89`); no `setUser`/`setTag`/`setContext`/`withScope` exists anywhere (grep over *.ts, *.md). Only `user.id` appears in common's scope tests as a sample key.
- Not wired: `pipeline.ts` `enrich` (:69) stamps id, time, level, mechanism and `normalizeAttributes(input.attributes)` and never touches Scope. No file under observability/src imports Scope (grep). `trace` and `breadcrumbs` are also unfilled. The logger likewise reads no Scope. So ADR-0006/0007's merge order is design, not implementation.
- `Scope.get` is by key, walks ancestors; there is no enumerate/entries API, so a reporter must add one (or a ScopeNode walker) to flatten the chain into `attributes`. Ancestry is deliberately not public (ADR-0006 last paragraph before Considered options).
- Test conventions: coverage is 100% in `source/core/vitest.shared.ts:18`; observability is one lydite component `core-observability` (`.lydite/components.yml`), so errors has no component of its own. Tests restore the `Symbol.for("vipengele:scope:tree")` slot in `afterEach` (`root.test.ts:229`) and swap carriers via `getOrCreateRegistryEntry("scope")` plus restore (`scope.test.ts:229`).
