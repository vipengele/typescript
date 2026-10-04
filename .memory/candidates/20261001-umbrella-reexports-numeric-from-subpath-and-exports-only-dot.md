---
about: ADR-0004 says the umbrella mirrors entry points one-to-one as sub-path exports, but the umbrella has only "." and imports from sub-paths internally; no test or CI check enforces either claim
targets: umbrella-reexports-names-individually
verdict: still-true
saw:
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/package.json
  - source/ts/packages/ts/tsup.config.ts
  - source/core/packages/common/package.json
  - source/core/packages/common/tsup.config.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - agentic/instructions/common-runtime-sub-path.md
---

Note was not stale; claim re-verified (index.ts lists names individually, line 1 `export { Numeric } from "@vipengele/ts-core-common/types/numeric"`).
Additional facts:
- Umbrella `package.json` exports only `"."` and `./package.json`; single tsup entry `src/index.ts`. So ADR-0004's
  "Consumers import through the umbrella ... mirrors every entry point one-to-one as `export * from`" is aspirational:
  actual re-exports are named, from the root entry. No rule/test enforces one-to-one. ADR-0004's "bundle check"
  (no `node:` in dist, no inlined @vipengele code in the umbrella) was not found in .github/workflows or actions
  (grep for inlin/external/node: -> nothing). `no-node-specifiers-in-shipped-source` is enforced only by biome grit lint.
- Adding a sub-path to common needs 3 places: `exports` entry (`types` + `default` into dist, no node/browser conditions,
  `package.json:25-56`), a tsup `entry` line (`tsup.config.ts:4-11`), and an `index.ts` under src. Declarations come from
  `tsc -p tsconfig.build.json` after tsup. `sideEffects:false` is package-wide. `.lydite/components.yml` has one
  component per package (core-common dir covers every sub-path) so no per-sub-path registration; coverage thresholds are
  100% across node+chromium union (`source/core/vitest.shared.ts`).
- Nothing enforces the exports list against tsup entries; they drift silently. `agentic/instructions/common-runtime-sub-path.md`
  and `agentic/vipengele-typescript.md` enumerate the sub-paths in prose and must be edited (then `agtk render`).
- Umbrella has no README content on Numeric; common README has no `./types/numeric` section either (0 hits).
