---
about: "integration replace-by-name and newest-first teardown still hold; line pointers in the note have moved"
saw:
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/integration.ts
targets: integrations-replace-by-name-and-tear-down-newest-first
verdict: still-true
---
Re-read while planning issue #49. Map keyed by name: `builder.ts:116` (field), `:173-174` (`add` -> `set(integration.name, ...)`).
`setupIntegrations` is `integration.ts` (skip on throwing setup, reverse teardown, `splice(0)` so once). `close()` runs
`teardown()` then `transport.close()` at `reporter.ts:149-151`. Note's pointers `builder.ts:21,39-41` and `reporter.ts:63-66` are out of date.
The IntegrationHost (`capture`, `flush`) has no breadcrumb method; an integration records via `Scope.addBreadcrumb` directly.
