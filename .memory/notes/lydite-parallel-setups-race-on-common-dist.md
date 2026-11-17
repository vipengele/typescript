---
name: lydite-parallel-setups-race-on-common-dist
kind: gotcha
description: Three lydite components each rebuild core-common in setup, so parallel component runs can race on common/dist and fail with ENOENT unlink before any test runs; --concurrency 1 avoids it.
anchors:
  - path: .lydite/components.yml
    blob: ae30163ab9e0
  - path: source/core/packages/common/tsup.config.ts
    blob: 7197bb9cc9ec
confidence: suspect
---

Checked in the files: `core-observability`, `core-http` and `core-resilience` each run
`pnpm --filter @vipengele/ts-core-common run build` in `setup`
(`.lydite/components.yml:26,38,49`), because lydite has no build graph
([[workspace-deps-resolve-through-dist-only]]). That build starts with tsup's `clean: true`
(`source/core/packages/common/tsup.config.ts:22`), which empties `common/dist`.

Reported by the explorer, not reproduced here: `lydite test` runs components four at a time by
default, so two setups can rebuild `source/core/packages/common/dist` at once; one build's clean
unlinks a file the other is writing and the component fails at setup with
`ENOENT: no such file or directory, unlink '.../common/dist/...'`. Which component fails varies
from run to run. `lydite test --concurrency 1` runs the setups in turn and passes.

Treat that ENOENT as a setup race, not a test failure.
