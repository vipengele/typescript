---
about: no module in the repo learns its own URL; node: imports banned; every package is one build for browser and Node with 100% union coverage
saw:
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - source/core/biome/no-node-imports.grit
  - source/core/vitest.shared.ts
  - source/core/packages/observability/tsup.config.ts
---
Evidence:
- `grep -rn 'import\.meta|__filename|__dirname|fileURLToPath'` excluding node_modules -> only source/*/biome/check-node-import-ban.mjs (lint tooling, not shipped). No shipped code uses import.meta; tsup config (observability/tsup.config.ts) is plain esm, es2022, no define/banner/shims, sourcemap true.
- ADR-0004: one file per entry point in every runtime, no node/browser export conditions; node: specifiers only via `import type` (no-node-imports.grit), Node built-ins via process.getBuiltinModule. So "reporter's own frames" cannot use node:url/__filename; options are import.meta.url (untested, needs ES2022 module target, fine for tsup esm) or marking by a stable function-name/marker or by capturing a stack at module load, all new patterns.
- vitest.shared.ts: 100% statements/branches/functions/lines, coverage = union of node and chromium. Runtime-detection precedent (ADR-0004): "Capability detection accepts an injected capability source, so a unit test forces the branches of runtimes the suite does not run in" -> SpiderMonkey/JSC parsing must be covered by fixture strings (the parser takes a string, so pure-function tests suffice in both runtimes; Chromium run only exercises V8 format for real, and node is also V8).
- Source of own-path in tests: tests run from src/*.ts, dist from bundled index.js, so a self-URL differs between test and build; any self-detection must be tested with an injected path.
- Dead ends: git log --all --grep 'stack|frame|in-app' -> no commits; only branches main and claude/friendly-pasteur-iamh70 (same head e641f0e). No prior attempt or abandoned work found.
