---
about: global-handlers' Node path declares its own structural process type, and flushTimeoutMs is the repo's only timeout default
saw:
  - source/core/packages/common/src/runtime/identity.ts
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/observability/src/errors/integrations/global-handlers.ts
  - source/core/packages/observability/src/errors/integrations/global-handlers.node.test.ts
  - source/core/vitest.shared.ts
---
- `RuntimeSource.process` models only `getBuiltinModule`, `versions`, `env`, `stdout` and
  `on: unknown` (identity.ts), so a handler that removes listeners or exits cannot use it.
  `GlobalProcess` (`{ on; off; exit }`, global-handlers.ts) is declared locally; there is no
  `@types/node` and no `node:` import in `src` (biome's import-ban check enforces the second).
- `detectCapability("processExitHooks")` (capabilities.ts) is a yes/no gate only: it requires
  `getBuiltinModule` and `on` to be functions, which rules out a bundler `process` polyfill. The
  handler reads `globalThis.process` itself after the gate passes.
- `DEFAULT_FLUSH_TIMEOUT_MS` = 2000 in global-handlers.ts is the first default timeout in the
  package; every other `timeoutMs` is caller-supplied (ADR-0012).
- The Node default-source branch is covered by `global-handlers.node.test.ts`, which installs on the
  real `process` and uninstalls without emitting; every other branch uses an injected fake process
  in a plain `*.test.ts`, so the node and chromium coverage union stays at 100%. Real emissions
  under Vitest were not tried and stay unverified.
