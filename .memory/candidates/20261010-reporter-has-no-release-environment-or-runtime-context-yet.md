---
about: Nothing sets release, environment, dist or runtime context today; the Resource (four reserved Scope-root keys) is the only home for service identity, and the pipeline's processors/filters stages exist but the builder cannot populate them
saw:
  - source/core/packages/observability/src/errors/pipeline.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/event.ts
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/src/runtime/identity.ts
  - docs/adr/0006-one-scope-tree-shared-by-the-logger-and-the-reporter.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
---
Found while planning issue #41 (release/environment/dist, runtime context, enabledEnvironments).

- `createReporter` hard-codes `processors: [], filters: []` (reporter.ts, the `createCapture({...})` call); `ReporterBuilder` has no processor or filter method. So ADR-0010's five stages are real in `pipeline.ts` (`deliver`: redaction, processors.reduce, filters.every, transport.send) but only normalize/enrich/redact/transport are reachable by a user today.
- `ErrorEvent` (event.ts) has no release/environment/contexts/tags/user field; ADR-0007 says deliberately "No separate tags, extra or user": everything is `attributes`. Event `attributes` explicitly exclude the Resource (event.ts doc, pipeline.ts `scopeAttributes`).
- Service identity: ADR-0006 + ADR-0007 "The Resource is sent once": root Scope holds `service.name`, `service.version`, `deployment.environment.name`, `process.runtime.name`, set only via `Scope.setResource` (root.ts `setResource`), read per event by `eventResource()` and passed as `send`'s 2nd arg. Nothing in the repo sets any Resource key automatically (grep `process.runtime.name` -> only types/defaults in root.ts, pipeline.ts, logger/provider.ts, scope.ts). CONTEXT.md "Resource" already says it is "which service, release, environment and runtime is emitting". No ADR states "single source of identity" in those words, but ADR-0007 + CONTEXT.md imply it.
- Runtime: `detectRuntime` returns a family only; `RuntimeSource` already models `navigator.userAgent` and `process.versions.node` (identity.ts) but no code parses a UA or exposes Node version/platform/OS. `process.platform` is not on the `RuntimeSource.process` slice.
- Gate options in the existing code: no enabled/off concept in the reporter (grep for enabled/threshold in errors/*.ts: none). Config errors use `ReporterConfigError` (code `observability.errors.config`), validated in the builder method at call time, builder left unchanged on throw (builder.ts `limits`).
