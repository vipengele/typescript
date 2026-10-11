---
about: build-runs-tsup-before-tsc still holds; only file blobs moved
saw:
  - source/core/packages/redaction/package.json
  - source/core/packages/redaction/tsup.config.ts
  - source/core/packages/redaction/tsconfig.build.json
targets: build-runs-tsup-before-tsc
verdict: still-true
---
redaction package.json scripts.build = `tsup && tsc -p tsconfig.build.json`; tsup.config.ts has `dts: false`, `clean: true`; tsconfig.build.json `emitDeclarationOnly: true`, outDir dist. Pointers to common/package.json:66 not re-line-checked.
