---
about: workspace-deps-resolve-through-dist-only's claim still holds as-is for @vipengele/ts-core-common
saw:
  - source/core/packages/common/package.json
  - source/core/turbo.json
  - .lydite/components.yml
targets: workspace-deps-resolve-through-dist-only
verdict: still-true
---

Re-checked while investigating issue #17 (JSON-safe bounded serialization in
`@vipengele/ts-core-common`). `package.json`'s `exports` still point every condition's `types`
into `./dist/...` (now lines 29-42, note cites 29-39 — three subpaths today: `./types/numeric`,
`./context`, plus, on the unmerged `feature/issue-14` branch only, `./attributes`). `turbo.json`
still has `"dependsOn": ["^build"]` on `type-check` and `test`. `.lydite/components.yml`'s
`core-common` component has no `depends_on`/`setup` block, which is expected and consistent with
the note: `core-common` itself has no workspace dependency on another `@vipengele/*` package, so
there is nothing for lydite to build first. A new sub-path added to `core-common` does not change
any of this — it only adds another `exports` key and `tsup` entry, per
[[json-safe-serializer-prior-art-on-issue-14-branch]].
