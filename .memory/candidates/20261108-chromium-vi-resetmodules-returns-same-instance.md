---
about: "vi.resetModules plus a re-import does not give a fresh module instance under the chromium Vitest project; simulate a second package copy through the Symbol.for slot instead"
saw:
  - source/core/packages/observability/src/breadcrumb-suppression.test.ts
  - source/core/packages/observability/src/errors/integrations/auto-breadcrumbs/registry.test.ts
  - source/core/packages/observability/src/logger/logging.test.ts
---
A test asserting cross-copy behaviour by re-importing a module after `vi.resetModules()` passes in node and fails in chromium,
where the re-import yields the same instance. The suites that check state shared across copies read and write the
`globalThis[Symbol.for(...)]` slot directly as the "other copy" (`breadcrumb-suppression.test.ts`, `registry.test.ts`,
`logging.test.ts`).
