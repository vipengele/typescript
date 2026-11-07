---
about: "source/core/turbo.json declares no passThroughEnv, so pnpm test under turbo's strict env mode drops PLAYWRIGHT_BROWSERS_PATH and the chromium project looks for browsers in ~/.cache/ms-playwright"
saw:
  - source/core/turbo.json
  - source/core/vitest.shared.ts
---
- `pnpm test` in a package directory runs vitest directly and sees `PLAYWRIGHT_BROWSERS_PATH`; `pnpm test` from `source/core` goes through turbo, whose strict env mode filters variables not declared in `turbo.json`, so the chromium Vitest project fails with "Executable doesn't exist at ~/.cache/ms-playwright/...".
- A package's tests passing when run alone is therefore not evidence the project-level `pnpm test` passes in an environment whose browsers live outside the default cache path.
