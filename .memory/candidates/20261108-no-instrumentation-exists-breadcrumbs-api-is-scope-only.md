---
about: "no console/fetch/XHR/history patching exists anywhere in src; breadcrumb sources today are Scope.addBreadcrumb and loggerSink only; adding auto-instrumentation must be an Integration and avoid self-recursion"
saw:
  - source/core/packages/observability/src/errors/integration.ts
  - source/core/packages/observability/src/errors/integrations/global-handlers.ts
  - source/core/packages/observability/src/errors/transports/console-transport.ts
  - source/core/packages/observability/src/errors/transports/http/request.ts
  - source/core/packages/observability/src/delivery/delivery.ts
  - docs/adr/0027-breadcrumbs-are-a-bounded-buffer-per-unit-of-work.md
---
`grep` for pushState/XMLHttpRequest/console assignment in `packages/*/src` (non-test): zero patches. Only readers: transports and
sinks call `globalThis.fetch` at send time (`delivery.ts:175`, `http/request.ts:282,316`, `offline-queue.ts:94`) and `console.*`
(`console-transport.ts:25`, `http-transport.ts`, `logger/provider.ts:365`, `global-handlers.ts` exit path `console.error`). Because they
look up `globalThis.fetch`/`console` at call time, a patched global would be hit by the reporter's own delivery and console output
(recursion/noise risk) -- an instrumentation must skip the reporter's own requests and not breadcrumb its own transport.
globalHandlers (ADR-0012 numbering, `0012-global-handlers-...`) is the install/teardown pattern: Integration via `builder.add`, returns teardown,
no realm-wide `Symbol.for` guard by decision. Wrapping globals is not covered by that decision: two reporters patching fetch would chain.
Observability package depends on `@ts-core-redaction` via `workspace:*` (package.json:57); `redactUrl` is not yet used in observability src.
