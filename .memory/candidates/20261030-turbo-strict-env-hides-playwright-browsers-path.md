---
about: "turbo.json passes no env through, so PLAYWRIGHT_BROWSERS_PATH never reaches pnpm test under turbo and Playwright looks in ~/.cache/ms-playwright"
saw:
  - source/core/turbo.json
  - source/core/package.json
---
`pnpm test` is `turbo run test` (source/core/package.json), and turbo.json declares no `env`/`passThroughEnv`/`globalPassThroughEnv`, so turbo's strict env mode strips variables such as `PLAYWRIGHT_BROWSERS_PATH` from the task. A package's own `pnpm test` sees the variable and passes while the turbo run fails with "Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-<rev>". The browser revision must match the pinned `playwright` devDependency, and it has to be installed where Playwright's default path looks (or symlinked there).
