---
about: The umbrella re-exports by name from common's sub-paths and exports only "."; ADR-0004's one-to-one `export *` mirror is aspirational; a common sub-path needs an exports entry, a tsup entry and an index.ts, and package-exports.test.ts keeps the first two in step
targets: umbrella-reexports-names-individually
verdict: still-true
saw:
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/package.json
  - source/core/packages/common/package.json
  - source/core/packages/common/tsup.config.ts
  - source/core/packages/common/src/package-exports.test.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - agentic/instructions/common-runtime-sub-path.md
---

- `source/ts/packages/ts/src/index.ts` lists names individually from sub-paths (`export { Numeric } from
  "@vipengele/ts-core-common/types/numeric"`, `export { Locale } from "@vipengele/ts-core-common/locale"`, plus
  `export type { … }`), no `export *`. The umbrella's `exports` is `"."` and `./package.json` only. ADR-0004's
  "mirrors every entry point one-to-one as `export * from`" is not what the code does.
- A new sub-path of `@vipengele/ts-core-common` needs an `exports` entry (`types` + `default` into `dist/<sub>/index.*`), a
  `src/<sub>/index.ts` entry in `tsup.config.ts`, and the `index.ts`. `src/package-exports.test.ts` checks the first two
  against each other in both directions and that each entry points at its own dist directory; it reads
  `tsup.config.ts` as raw text through `import.meta.glob`, so a tsup entry written any way other than a
  `"src/<sub>/index.ts"` string literal is invisible to it.
- The sub-path lists in `agentic/instructions/common-runtime-sub-path.md` and `agentic/vipengele-typescript.md` are prose
  and are edited by hand, then `agtk render`.
- The umbrella resolves common through `dist`, so core is built before anything in `source/ts` is type-checked or tested.
