---
about: "a test-only helper in observability src/ is named *.test-support.ts, which tsconfig.build.json and the coverage config exclude; any other non-test name ships its .d.ts in dist/"
saw:
  - source/core/packages/observability/tsconfig.build.json
  - source/core/vitest.shared.ts
  - source/core/packages/observability/src/delivery/offline/fake-indexed-db.test-support.ts
---
Declarations come from `tsc -p tsconfig.build.json`, whose `exclude` is `src/**/*.test.ts` and `src/**/*.test-support.ts`;
tsup bundles only from entry points, so an unreachable helper is absent from the JS but its `.d.ts` is still emitted by
tsc unless excluded. vitest.shared.ts excludes the same two globs from coverage, and its test `include`
(`src/**/*.test.ts`) does not match `*.test-support.ts`, so such a file is never run as a suite. Only the observability
package's tsconfig.build.json carries the second glob.
