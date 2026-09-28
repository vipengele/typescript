---
about: build-runs-tsup-before-tsc's claim still holds; only its cited line numbers moved
saw:
  - source/core/packages/common/package.json
targets: build-runs-tsup-before-tsc
verdict: still-true
---

Re-checked while investigating what constrains adding a new sub-path export to
`@vipengele/ts-core-common` for issue #17.

`source/core/packages/common/package.json`'s `build` script is still `"tsup && tsc -p
tsconfig.build.json"`, now at line 49 (note cites 45). `tsup.config.ts` still has `clean: true`
and `dts: false`; `tsconfig.build.json` still `emitDeclarationOnly`. The ordering requirement
(tsup first, or its clean wipes tsc's `.d.ts` output) is unchanged.
