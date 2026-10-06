---
about: ADR-0006/0007 reject Sentry's global/isolation/current layers and separate tags/user/extra; Scope is attributes-only (tag = breadcrumb), the reporter's enrich reads the non-root chain through the internal snapshot(), and the logger reads only Scope.resource
saw:
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/scope/scope.ts
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/observability/src/logger/record.ts
---
Evidence (found while implementing issue #40 "Scopes"):

- ADR-0006 "Considered options" rejects "Sentry's global -> isolation -> current layers" (three concepts with different mutability where one tree suffices). Root = global/Resource (frozen bag, replaced in place only by `Scope.setResource`, `root.ts` createScopeTree), `Scope.isolated` = isolation, `Scope.inherit` = current. ADR-0007 gives `ErrorEvent` only `attributes`: no `tags`, `extra` or `user`, and no `withScope` exists; `Scope.setUser`/`setTag`/`setContext` write flat dotted attribute keys to the current scope.
- The reporter reads Scope through `snapshot(scope)` in `root.ts`, which flattens every non-root ancestor's attributes, innermost wins, never the root's Resource keys, with a stored `undefined` shadowing an outer value as `Scope.get` does. `pipeline.ts` `enrich` merges that beneath the call's own attributes, each side normalized separately so a large scope chain cannot push call attributes into the truncation marker. A throw while reading the scope yields no scope attributes; the event still goes out.
- `snapshot` lives in `root.ts` because the `Symbol.for`-keyed ancestry and attribute slots are module-private there and other copies of the package read the same slots. It is exported from `./scope` as framework-internal; ancestry is otherwise not public (ADR-0006).
- The logger does not read Scope attributes: `logger/record.ts` states the ambient Scope's attributes are not part of a record, and the only Scope touchpoint is `Scope.resource` passed to sinks as a separate argument. A Transport receives the Resource as `send`'s second argument.
- Unfilled: `trace` and `breadcrumbs` on `ErrorEvent`; the breadcrumb trail (tagged ancestors) is not read into events.
- Test conventions: coverage is 100% in `source/core/vitest.shared.ts`; observability is one lydite component `core-observability` (`.lydite/components.yml`). Tests restore the `Symbol.for("vipengele:scope:tree")` slot in `afterEach` (`root.test.ts`). Chromium's synchronous-stack carrier loses Scope after the first `await` (ADR-0006), so interleaved-`await` isolation tests are `*.node.test.ts`.
