---
about: "in Chromium tests the current Scope does not survive an await inside Scope.isolated; assert breadcrumb trails synchronously or bind with Scope.propagate"
saw:
  - source/core/packages/common/src/context
  - source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/xhr.browser.test.ts
  - source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/fetch.ts
---
Chromium has no `AsyncLocalStorage`, so `createAsyncContextStore` falls back to the synchronous stack carrier (ADR-0004). After an
`await` inside `Scope.isolated(...)` the current scope is the default one, and a breadcrumb recorded there goes to the root trail.
Tests that run under both node and chromium must record and read the trail synchronously, or bind the recorder with
`Scope.propagate` first (`xhr.browser.test.ts`). The same reason is why `fetch.ts` captures
`Scope.propagate((input) => Scope.addBreadcrumb(input))` when a request starts: without it a settled request records into
whatever scope is current at settlement. A real `popstate` fires in its own task and records into the root trail.
