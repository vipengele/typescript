---
name: reporter-has-no-self-path-detection
kind: rationale
description: "The reporter never marks its own frames not-in-app because no shipped module can learn its own URL; import.meta.url is wrong once bundled."
anchors:
  - path: source/core/packages/observability/src/errors/stack/in-app.ts
    blob: df2edbffbd4b
  - path: source/core/packages/observability/tsup.config.ts
    blob: d2c1588f4b2f
  - path: source/core/packages/observability/README.md
    blob: b4cc5ba484dc
  - path: source/core/vitest.shared.ts
    blob: 7f974add00ae
confidence: verified
---

`in-app.ts:11,48` classifies a frame by a `node_modules` path segment (or project root) and does
no self-detection; the README says so at `README.md:279`. Don't "fix" this by deriving the
reporter's location from `import.meta.url`: under bundling it resolves to the application's
bundle, so every application frame would be marked not-in-app. Unbundled, the reporter's frames
are already under `node_modules`; bundled into an app they are in-app, and that is accepted.

Related constraints: `tsup.config.ts` is plain esm with no define/banner/shims, so there is no
build-time injection of a path, and `source/core/biome/no-node-imports.grit:10` bans `node:`
imports other than `import type` (ADR-0004), so `fileURLToPath` is unavailable too. A self-path
would also differ between tests (`src/*.ts`) and the built bundle.

Coverage gate is 100% over a node and a chromium project (`vitest.shared.ts:13-45`), both V8, so
SpiderMonkey and JavaScriptCore stack formats are only reachable through fixture strings.
