---
name: umbrella-reexports-names-individually
kind: gotcha
description: The @vipengele/ts umbrella re-exports names one by one (no export *, contrary to ADR-0004), so a new export in a core package doesn't reach umbrella consumers until it is added to the umbrella index.
anchors:
  - path: source/ts/packages/ts/src/index.ts
    blob: 6468b57c3cae
  - path: source/ts/packages/ts/src/index.test.ts
    blob: 72fc2ec64c9c
  - path: agentic/vipengele-typescript.md
    blob: da9a64c1d5d0
  - path: source/core/packages/common/src/package-exports.test.ts
    blob: c6529acee5be
confidence: verified
---

`source/ts/packages/ts/src/index.ts` lists each export by name from the sub-paths of
`@vipengele/ts-core-common` and from `@vipengele/ts-core-redaction`, with separate `export type { … }`
blocks (e.g. `index.ts:1-3`, `:4-27`). ADR-0004's "mirrors every entry point one-to-one as
`export * from`" is not what the code does. A new export therefore stays invisible through
`@vipengele/ts` until added there, with a test in `index.test.ts` and an update to the re-export
sentence in `agentic/vipengele-typescript.md` (then `agtk render`). The umbrella resolves core through
`dist/`, so its tests see a new export only after core is rebuilt
([[workspace-deps-resolve-through-dist-only]]).

A new sub-path of `@vipengele/ts-core-common` needs an `exports` entry, a `src/<sub>/index.ts` entry in
`tsup.config.ts`, and the `index.ts`. `package-exports.test.ts` checks the first two against each
other but reads `tsup.config.ts` as raw text, so a tsup entry that is not a `"src/<sub>/index.ts"`
string literal is invisible to it.
