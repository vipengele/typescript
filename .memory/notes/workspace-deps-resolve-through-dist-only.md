---
name: workspace-deps-resolve-through-dist-only
kind: invariant
description: A @vipengele/* workspace dependency resolves only through its built dist/, so type-check, test and lydite must build dependencies first.
anchors:
  - path: source/*/packages/*/package.json
    matches:
      - path: source/core/packages/common/package.json
        blob: 9f41e3c73ba2
      - path: source/core/packages/observability/package.json
        blob: f27cf10262ed
      - path: source/core/packages/redaction/package.json
        blob: 287f01ca8eac
      - path: source/ts/packages/ts/package.json
        blob: 3d18717ee2dd
  - path: source/core/turbo.json
    blob: 5a8e82c329f3
  - path: source/core/tsconfig.base.json
    blob: 09df051657eb
  - path: .lydite/components.yml
    blob: 9fa06ecb5afd
confidence: verified
---

In every package's `exports`, the `types` condition points into `./dist/` only. There is no
`source` or `development` condition and no path fallback: see
`source/core/packages/common/package.json:29-39` and
`source/core/packages/observability/package.json:37,41`. `tsconfig.base.json` has no `paths`
(`source/core/tsconfig.base.json:6-23`, `moduleResolution: "bundler"`). A package that imports a
sibling can therefore see only the sibling's build output, never its source.

This is why:

- `source/core/turbo.json:8-13` puts `"dependsOn": ["^build"]` on `type-check` and `test`, not
  only on `build`. That line carries real weight.
- Running a single package directly without turbo, e.g.
  `pnpm --filter @vipengele/ts-core-observability type-check` on a fresh clone, fails to resolve
  `@vipengele/ts-core-common` and `@vipengele/ts-core-redaction` until those have been built.
  That is expected; the workspace link is not broken.
- lydite runs each component's suite itself, with no build graph. So `core-observability`
  hand-wires `depends_on` plus two `pnpm --filter ... run build` `setup` steps
  (`.lydite/components.yml:19-27`). Nothing keeps that block in sync with `package.json`
  dependencies. A new package with a workspace dependency needs its own block written by hand,
  while turbo's `^build` picks up the new edge on its own. Leave the block out and lydite tests
  against a stale or missing `dist/`. That looks like a flaky result, not a config error.

The build order that produces a complete `dist/` is covered in [[build-runs-tsup-before-tsc]].
