---
about: "environment-source.node.test.ts' 'is read once per realm' test can hit vitest's 5 s timeout under a full parallel turbo test run, and passes on rerun and in a package-only run"
saw:
  - source/core/packages/observability/src/logger/environment-source.node.test.ts
---
`Logging and VPG_LOG` › "is read once per realm: never on import or Logger creation, once on the first
level check" (`environment-source.node.test.ts`) loads fresh copies of the logger modules, and under
`pnpm test` from `source/core`, where turbo runs all four packages' Node and Chromium suites at once
(vitest reported workers at 92%), it can exceed the default 5000 ms test timeout. It passed in every
observability-only run and on a rerun of the full suite. Like `pipeline.test.ts`' wall-clock flood
test, it is load-sensitive, not a logic failure: rerun once before investigating.
