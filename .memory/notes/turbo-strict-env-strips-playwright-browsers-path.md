---
name: turbo-strict-env-strips-playwright-browsers-path
kind: gotcha
description: turbo.json passes no env through, so `pnpm test` from source/core drops PLAYWRIGHT_BROWSERS_PATH and the Chromium project fails, while a package-level `pnpm test` passes.
anchors:
  - path: source/core/turbo.json
    blob: 5a8e82c329f3
  - path: source/core/package.json
    blob: c33fd091fba9
confidence: verified
---

`pnpm test` in `source/core` is `turbo run test` (`source/core/package.json:8`), and
`source/core/turbo.json:1-15` declares no `env`, `passThroughEnv` or `globalPassThroughEnv`.
turbo's strict env mode therefore strips `PLAYWRIGHT_BROWSERS_PATH` from the task, and the
Chromium Vitest project fails with "Executable doesn't exist at ~/.cache/ms-playwright/...".

A package's own `pnpm test` runs vitest directly, sees the variable and passes. So a package
suite passing alone is not evidence that the project-level run passes in an environment whose
browsers live outside the default cache path. The browser revision must match the pinned
`playwright` devDependency (`source/core/package.json:17`) and be installed, or symlinked, where
Playwright's default path looks.
