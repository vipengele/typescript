---
about: In packages/common, `vite` is not directly resolvable, so import.meta.glob is typed by a local cast, and Biome's noSecrets rule flags camelCase identifiers used as test names
saw:
  - source/core/packages/common/src/package-exports.test.ts
  - source/core/packages/common/src/locale/locale.test.ts
---

- `package-exports.test.ts` cannot use `/// <reference types="vite/client" />` or `*?raw` import types because `vite` does
  not resolve from `packages/common`. It types the one `import.meta.glob(…)` call with a local `GlobMeta` cast. Vite only
  rewrites the literal `import.meta.glob(` call, so destructuring `glob` off `import.meta` breaks it.
- A `describe` or `it` title that is a camelCase identifier such as `firstDayOfWeek` is flagged by Biome's `noSecrets`
  as a high-entropy string; `locale.test.ts` names the block in words ("first day of the week") instead.
- A suite that reads files at test time and must run in both the node and chromium Vitest projects goes through
  `import.meta.glob` with `query: "?raw"`; a `node:fs` import is banned in shipped `src/` and unavailable in chromium.
