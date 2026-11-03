---
about: "lydite test's parallel component setups can race on core-common's dist: core-observability and core-resilience both rebuild it, and one build's cleanup unlinks the other's output"
saw:
  - .lydite/components.yml
---
`core-observability` and `core-resilience` each list `pnpm --filter @vipengele/ts-core-common run build`
in their `setup` (`.lydite/components.yml`), because lydite's vitest runner has no build graph and both
import `core-common` through its `dist/`. `lydite test` runs components four at a time by default, so
the two setups can rebuild `source/core/packages/common/dist` at once; tsup's clean step in one then
unlinks a file the other is writing, and the component fails at setup with
`ENOENT: no such file or directory, unlink '.../common/dist/...'` before any test runs. Which of the two
fails varies from run to run. It is a setup race, not a test failure: `lydite test --concurrency 1`
runs the setups one after another and passes.
