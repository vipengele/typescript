---
about: where a custom biome `node:` import ban can live, and what it would trip; no GritQL plugin or static node: import exists today
saw:
  - source/core/biome.json
  - source/ts/biome.json
  - source/core/package.json
  - .github/actions/changed-projects/action.yml
  - .lydite/components.yml
---

Found while planning issue #13.

- Biome is `@biomejs/biome` 2.5.12 in both `source/core/package.json` and `source/ts/package.json`; one `biome.json` per project, no shared/extended config. core's differs from ts's only by an `overrides` entry (noStaticOnlyClass off for `**/types/numeric/index.ts`). Lint script: `biome lint . --error-on-warnings`; biome reads the .gitignore beside its config.
- `find . -name '*.grit'` (excl. node_modules) -> 0; biome.json has no `plugins`. So no existing plugin. Biome plugin paths are relative to the biome.json, and repo-root code is forbidden (rule all-code-lives-under-source), so a rule must be repeated per project (e.g. source/<project>/<rules dir>/*.grit) or live in one project and be referenced by relative path -- the latter would escape the pnpm workspace and CI's changed-projects would not select the referencing project on a change to the sibling. Existing precedent for repeating: each project carries its own vitest.shared.ts/biome.json/tsconfig.base.json.
- changed-projects (`action.yml:54`): `^(\.github/(workflows/ci-[a-z]+\.yml|actions/)|\.lydite/)` = shared CI, selects every project; anything under source/<project>/ selects that project plus dependents. So a per-project rule file only triggers that project.
- Static `node:` imports today: grep for `from "node:`/`require("node:` across source/ and .github/ (excl. node_modules, dist) -> 0 files. Only string mentions (capabilities.ts, capabilities.test.ts, README). Config files (tsup.config.ts, vitest.shared.ts, vitest.config.ts) import none. So a naive ban trips nothing now, but future *.node.test.ts / configs would; ADR-0004 says only `import type` is allowed and does not carve out tests or configs -- an exemption is an open decision. Also common has no @types/node, so even `import type` from node: fails type-check there (see candidate 20260926-common-package-has-no-types-node).
