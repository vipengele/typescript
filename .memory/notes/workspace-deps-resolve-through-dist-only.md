---
name: workspace-deps-resolve-through-dist-only
kind: invariant
description: A @vipengele/* workspace dependency resolves only through its built dist/, so type-check, test and lydite must build dependencies first.
anchors:
  - path: source/*/packages/*/package.json
    matches:
      - path: source/core/packages/common/package.json
        blob: 2178984ee284
      - path: source/core/packages/http/package.json
        blob: 32a836f4f88a
      - path: source/core/packages/observability/package.json
        blob: c93c42bc56d8
      - path: source/core/packages/redaction/package.json
        blob: cd548d20c340
      - path: source/core/packages/resilience/package.json
        blob: 7922a66c74a5
      - path: source/ts/packages/ts/package.json
        blob: 08cf05e5ee3c
  - path: source/core/turbo.json
    blob: 5a8e82c329f3
  - path: source/core/tsconfig.base.json
    blob: 09df051657eb
  - path: .lydite/components.yml
    blob: ae30163ab9e0
confidence: verified
---

In every package's `exports`, the `types` condition points into `./dist/` only. There is no
`source` or `development` condition and no path fallback: see
`source/core/packages/common/package.json:31-70` and
`source/core/packages/observability/package.json:37,41`. `tsconfig.base.json` has no `paths`
(`source/core/tsconfig.base.json:10`, `moduleResolution: "bundler"`). A package that imports a
sibling can therefore see only the sibling's build output, never its source.

This is why:

- `source/core/turbo.json:4-13` puts `"dependsOn": ["^build"]` on `type-check` and `test`, not
  only on `build`. That line carries real weight.
- Running a single package directly without turbo, e.g.
  `pnpm --filter @vipengele/ts-core-observability type-check` on a fresh clone, fails to resolve
  `@vipengele/ts-core-common`, `@vipengele/ts-core-redaction` and `@vipengele/ts-core-resilience`
  until those have been built. That is expected; the workspace link is not broken.
- lydite runs each component's suite itself, with no build graph. So `core-observability`
  hand-wires `depends_on: [core-common, core-redaction, core-resilience]` plus three
  `pnpm --filter ... run build` `setup` steps (`.lydite/components.yml:16-28`); `core-http` does
  the same (`:30-40`) and `core-resilience` builds `core-common` (`:42-49`). There is no `ts`
  component any more: `source/ts/packages/ts/**` is in `excludes` (`:73`). Nothing keeps a block in sync with `package.json`
  dependencies. A new package with a workspace dependency needs its own block written by hand,
  while turbo's `^build` picks up the new edge on its own. Leave the block out and lydite tests
  against a stale or missing `dist/`. That looks like a flaky result, not a config error.

The build order that produces a complete `dist/` is covered in [[build-runs-tsup-before-tsc]].
