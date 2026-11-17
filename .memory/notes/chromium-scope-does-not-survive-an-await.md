---
name: chromium-scope-does-not-survive-an-await
kind: gotcha
description: Chromium has no AsyncLocalStorage, so after an await inside Scope.isolated the current Scope is the default one; code and tests that record later must bind with Scope.propagate first.
anchors:
  - path: source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/fetch.ts
    blob: 0b43f0588ac8
  - path: source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/xhr.browser.test.ts
    blob: 305320230cc9
  - path: source/core/packages/common/src/context/async-context-store.ts
    blob: 052098adb727
confidence: verified
---

In a browser the async context store falls back to a synchronous stack carrier (see
[[async-context-carrier-lives-in-globalthis-symbol-slot]]). After an `await` inside
`Scope.isolated(...)`, `Scope.current()` is the default scope, and a breadcrumb recorded there
goes to the realm-wide root trail
([[breadcrumb-trail-belongs-to-the-nearest-child-of-root]]).

- Shipped code that records at settlement captures the scope when the work starts:
  `Scope.propagate((input) => Scope.addBreadcrumb(input))` in
  `source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/fetch.ts:75`.
- Tests that run under both Node and Chromium record and read the trail synchronously, or bind
  first with `Scope.propagate` (`xhr.browser.test.ts:31-32`).

A test that passes in Node and loses its breadcrumbs in Chromium is usually this.
