---
about: tests that need a fresh copy of the logger module load it with a query-string dynamic import, because vi.resetModules does not re-run an already loaded module under the Chromium project
saw:
  - source/core/packages/observability/src/logger/logging.test.ts
  - source/core/packages/observability/src/logger/slots.test.ts
  - source/core/packages/observability/src/logger/logging.ts
---
- `logging.ts` keeps `warnTarget` and `protocolsChecked` as per-copy module state. A test of the protocol-mismatch warn needs a copy whose `protocolsChecked` is unset; `vi.resetModules()` followed by `import("./logging")` returns the already loaded module in the Chromium Vitest project, so the flag stays set and the test fails there while passing under Node.
- The mismatch tests in `logging.test.ts` import `./logging?copy=<n>` (with `/* @vite-ignore */`), which yields a new instance in both runtimes.
- Tests that still rely on `vi.resetModules` to re-evaluate a module (the "module load" cases in `logging.test.ts` and `slots.test.ts`) may pass trivially under Chromium for the same reason.
- A planted `Symbol.for("vipengele.logger.provider.v2")` on `globalThis` must be deleted in `afterEach`, or every later test in the file sees a foreign protocol.
