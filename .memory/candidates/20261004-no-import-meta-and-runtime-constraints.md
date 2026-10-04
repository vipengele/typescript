---
about: no shipped module learns its own URL, so the reporter cannot mark its own frames; node: imports are banned in src; SpiderMonkey and JavaScriptCore stacks are covered by fixture strings
saw:
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - source/core/biome/no-node-imports.grit
  - source/core/vitest.shared.ts
  - source/core/packages/observability/tsup.config.ts
  - source/core/packages/observability/src/errors/stack/in-app.ts
---
Evidence:
- No shipped code uses import.meta, __filename, __dirname or fileURLToPath (only source/*/biome/check-node-import-ban.mjs, lint tooling). tsup is plain esm with no define, banner or shims.
- `import.meta.url` is the wrong self-path under bundling: it resolves to the application's bundle, so a reporter that excluded its own location would mark every application frame not-in-app. Unbundled, the reporter's frames sit under `node_modules` and are already not-in-app; bundled into an app they are in-app. in-app.ts therefore does no self-detection, and the package README says so.
- ADR-0004: one build per entry point in every runtime, no node/browser export conditions; node: specifiers appear only as `import type` (no-node-imports.grit). in-app.ts and parse-stack.ts hand-roll path and URL handling for that reason, and the code runs in Chromium.
- vitest.shared.ts: every `*.test.ts` runs in a node and a chromium project, both V8, with 100% statements/branches/functions/lines over the union. SpiderMonkey and JavaScriptCore stack branches are reachable only through fixture strings.
- A self-path would also differ between tests (src/*.ts) and the built bundle, so any self-detection would need an injected path to be testable.
