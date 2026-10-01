---
about: the node: import ban is a per-project biome grit plugin; tests are exempted by the plugin's own includes, not an override, and biome's built-in noNodejsModules still applies everywhere
saw:
  - source/core/biome.json
  - source/ts/biome.json
  - source/core/biome/no-node-imports.grit
  - source/core/biome/check-node-import-ban.mjs
  - source/core/package.json
  - .github/actions/changed-projects/action.yml
---

- The ban is `biome/no-node-imports.grit` in each of `source/core` and `source/ts`, registered under top-level `plugins` in each `biome.json`. Biome resolves plugin paths relative to the `biome.json`, and repo-root code is forbidden, so the two copies are identical and `check-node-import-ban.mjs` fails when they differ. `changed-projects` selects only the project whose files changed, so editing one copy fails that project's lint.
- In biome 2.5.12 an `overrides[].plugins` entry can only add a plugin; `"plugins": []` for `**/*.test.ts` does not switch a top-level plugin off. Test files are exempted by the plugin's own `includes` (`**/src/**/*.ts`, `!**/*.test.ts`).
- `lint` is `biome lint . --error-on-warnings && node biome/check-node-import-ban.mjs`. The script lints `biome/fixtures/{must-fail,must-pass}/src/*` against the project's real `biome.json` with `--vcs-use-ignore-file=false`. `fixtures/.ignore` (`*`) hides them from the plain `biome lint .`; excluding them through `files.includes` makes biome ignore them even when passed explicitly.
- `import { type X } from "node:…"` and `export type … from "node:…"` are banned: only `import type` is erased whole, and the inline form stays a side-effect import under `verbatimModuleSyntax`.
- Both projects set `"correctness": "error"`, which enables biome's built-in `noNodejsModules`. It also covers `*.test.ts` and configs, so a future `*.node.test.ts` importing a `node:` specifier fails lint through the built-in rule even though the plugin exempts it. The `biome/*.mjs` override turns it (and `noProcessGlobal`) off for the check script only.
- common has no `@types/node` (candidate 20260926-common-package-has-no-types-node), so even `import type` from a `node:` specifier fails type-check there.
