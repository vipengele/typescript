---
name: breadcrumb-trail-belongs-to-the-nearest-child-of-root
kind: gotcha
description: A breadcrumb buffer starts at each child of the Scope root and is shared below it, so the default scope's trail is realm-wide and never cleared; tests asserting a trail must run inside Scope.isolated.
anchors:
  - path: source/core/packages/common/src/scope/root.ts
    blob: f4ea48305e24
  - path: source/core/packages/observability/src/errors/logger-sink.ts
    blob: 8ff6c291a50d
confidence: verified
---

`bufferFor` (`source/core/packages/common/src/scope/root.ts:240-246`) gives a child of the root a
fresh buffer and any other child its parent's array. So each Unit of Work started directly under
the root (`Scope.isolated`, and the default scope) has its own trail, and scopes nested inside
share it.

Consequences:

- The default scope's buffer lives as long as the realm and nothing clears it; attaching to an
  event only reads it. A test that records or asserts breadcrumbs outside `Scope.isolated` sees
  crumbs from earlier tests in the same file. Vitest's per-file isolation stops it crossing files.
- `reporter.loggerSink()` records into the scope current when `write` runs
  (`source/core/packages/observability/src/errors/logger-sink.ts:77`). Wrapped in a batching
  sink, `write` runs at flush, so the crumb lands in whichever Unit of Work is current then. The
  data looks valid and nothing guards against it.

See also [[chromium-scope-does-not-survive-an-await]].
