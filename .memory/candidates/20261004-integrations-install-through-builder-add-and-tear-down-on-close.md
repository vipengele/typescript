---
about: how the error reporter's integrations are wired — builder.add, the host, name-replacement, teardown order and the global-handlers source selection
saw:
  - docs/adr/0012-global-handlers-are-an-integration-with-a-required-exit-policy.md
  - source/core/packages/observability/src/errors/integration.ts
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/observability/src/errors/reporter.ts
  - source/core/packages/observability/src/errors/integrations/global-handlers.ts
---
- `ReporterBuilder.add(integration)` keys integrations by `name` in a `Map`; a second `add` with the
  same name replaces the first and keeps its position (builder.ts). This, not a `Symbol.for` guard,
  is what prevents one reporter installing the same integration twice (ADR-0012 "No realm-wide
  guard"). Two reporters each installing `globalHandlers` is legitimate and each captures every error.
- `createReporter` builds the `IntegrationHost` from the same `createCapture` the public methods use
  (reporter.ts); the host's `capture` passes a per-event copy of the mechanism and the reporter's
  own `flush`. `Reporter` gained no method.
- `setupIntegrations` (integration.ts) contains a throwing `setup` (that integration is skipped) and
  a throwing teardown (the rest still run); teardowns run newest first, once. `close()` runs them
  before `transport.close()`, and a second `close()` calls `transport.close()` again but not the
  teardowns.
- `globalHandlers` picks its source in order: injected `eventTarget`, injected `process`,
  `globalThis` with an `addEventListener`, `globalThis.process` behind
  `detectCapability("processExitHooks")`, else nothing (global-handlers.ts). An injected source skips
  its probe/gate. Both Node listeners are always registered because an unhandled rejection with no
  listener reaches `uncaughtException`.
- The pipeline is synchronous, so `host.capture` inside a handler completes before the `"exit"`
  path awaits `host.flush`.
