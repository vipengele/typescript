---
name: chromium-reset-modules-does-not-give-a-fresh-module
kind: gotcha
description: Under the Chromium Vitest project vi.resetModules plus re-import returns the already evaluated module; a test needing a fresh copy imports it under a query string or plants the Symbol.for slot.
anchors:
  - path: source/core/packages/observability/src/logger/logging.test.ts
    blob: a52a1f79bbb5
  - path: source/core/packages/observability/src/logger/environment-source.node.test.ts
    blob: be1ae34035e8
  - path: source/core/packages/resilience/src/registry/default-registry.test.ts
    blob: afb72b880132
confidence: verified
---

`vi.resetModules()` followed by `import("./x")` re-evaluates the module under Node but "does not
reach a module the browser has already evaluated"
(`source/core/packages/observability/src/logger/logging.test.ts:72-76`). A test that relies on it
to reset per-copy module state passes in Node and fails, or passes trivially, in Chromium.

What works in both runtimes:

- Import under a distinct query string, `import(/* @vite-ignore */ "./logging?copy=<n>")`
  (`logging.test.ts:77-81`,
  `source/core/packages/observability/src/logger/environment-source.node.test.ts:48-49`,
  `source/core/packages/resilience/src/registry/default-registry.test.ts:125-126`).
- For state shared across package copies, read and write the `globalThis[Symbol.for(...)]` slot
  directly as "the other copy". A planted slot must be deleted in `afterEach`, or every later test
  in the file sees it.

Older suites still call `vi.resetModules` (`logging.test.ts:50`); treat a Chromium-only failure or
a suspiciously easy pass there as this, not as a logic bug.
