---
about: re-verified workspace-deps-resolve-through-dist-only after its anchors went stale; claim still holds unchanged
saw:
  - source/core/packages/observability/package.json
  - source/core/packages/common/package.json
  - source/core/turbo.json
  - source/core/tsconfig.base.json
  - .lydite/components.yml
targets: workspace-deps-resolve-through-dist-only
verdict: still-true
---

Re-checked while researching issue #54 (browser delivery / offline queue for
`@vipengele/ts-core-observability/errors`), because the note came back `stale: yes`.

All cited pointers still hold, with only cosmetic line drift:

- `source/core/packages/observability/package.json:37,41` — unchanged, `"types"` for `./logger`
  and `./errors` both point into `./dist/`.
- `source/core/packages/common/package.json:29-39` — the `exports` block now starts at line 30
  (was 29) after an unrelated line was added above it; content and shape identical.
- `source/core/turbo.json:8-13` — `type-check` and `test` still both carry
  `"dependsOn": ["^build"]`.
- `source/core/tsconfig.base.json:6-23` — `compilerOptions` still has no `paths`,
  `moduleResolution: "bundler"`.
- `.lydite/components.yml:19-27` — the `core-observability` component's hand-written
  `depends_on: [core-common, core-redaction]` plus two `pnpm --filter ... run build` setup steps
  are unchanged, still justified by the same comment (lydite's vitest runner has no build graph).

Relevant to anything landing in `errors/` (issue #54 and siblings #37/#44/#45): a new dependency
`@vipengele/ts-core-observability` picks up (e.g. on `@vipengele/ts-core-common`'s `./scope` or a
new IndexedDB/offline-queue helper split into its own package) is invisible to lydite unless the
`.lydite/components.yml` `core-observability` block is hand-updated to match — turbo's own
`^build` graph picks up a new package.json dependency automatically, lydite's does not.
