---
name: integrations-replace-by-name-and-tear-down-newest-first
kind: invariant
description: Reporter integrations are keyed by name in the builder (a repeat replaces in place, which is why there is no realm-wide guard), and close() tears them down newest first, once, before the transport closes.
anchors:
  - path: source/core/packages/observability/src/errors/builder.ts
    blob: 54d61c027b27
  - path: source/core/packages/observability/src/errors/integration.ts
    blob: 80d01a049bbd
  - path: source/core/packages/observability/src/errors/reporter.ts
    blob: 22350eec5be3
confidence: verified
---

- `ReporterBuilder.add` stores integrations in a `Map` by `name` (`builder.ts:21,39-41`); a second add
  with the same name replaces the first in its position. That, not a `Symbol.for` guard, stops one
  reporter installing an integration twice (ADR-0012 "No realm-wide guard"). Two reporters each
  installing `globalHandlers` is legitimate; each captures every error.
- `setupIntegrations` (`integration.ts:40-62`) skips an integration whose `setup` throws and keeps
  tearing down the rest when a teardown throws; teardowns run newest first and only once.
- `close()` runs the teardown before `transport.close()` (`reporter.ts:63-66`). A second `close()`
  calls `transport.close()` again but not the teardowns.
- The host's `capture` passes `{ ...mechanism }` so each event owns its mechanism (`reporter.ts:49-51`).
