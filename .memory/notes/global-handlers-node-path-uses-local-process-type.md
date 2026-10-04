---
name: global-handlers-node-path-uses-local-process-type
kind: rationale
description: globalHandlers declares its own structural GlobalProcess because RuntimeSource.process cannot remove listeners or exit; detectCapability is only a gate, and flushTimeoutMs is the repo's first timeout default.
anchors:
  - path: source/core/packages/common/src/runtime/identity.ts
    blob: 5b448acee24b
  - path: source/core/packages/common/src/runtime/capabilities.ts
    blob: c385daacad40
  - path: source/core/packages/observability/src/errors/integrations/global-handlers.ts
    blob: 74d12058b8ee
confidence: verified
---

- `RuntimeSource.process` models only `getBuiltinModule`, `versions`, `env`, `stdout` and
  `on: unknown` (`identity.ts:18-25`), so a handler that removes listeners or exits cannot use it.
  `GlobalProcess` (`{ on; off; exit }`, `global-handlers.ts:35-39`) is declared locally.
- `detectCapability("processExitHooks")` (`capabilities.ts:72-75`) is a yes/no gate: it needs
  `getBuiltinModule` and `on` to be functions, ruling out a bundler `process` polyfill. The handler
  then reads `globalThis.process` itself (`global-handlers.ts:113-118`).
- Both Node listeners are always registered, since an unhandled rejection with no listener reaches
  `uncaughtException` (`global-handlers.ts:71-73`, `164-165`).
- `DEFAULT_FLUSH_TIMEOUT_MS` = 2000 (`global-handlers.ts:61`) is the first timeout default in the
  repo (ADR-0012 line 51); other `timeoutMs` values are caller-supplied (`transport.ts:11-14`).
