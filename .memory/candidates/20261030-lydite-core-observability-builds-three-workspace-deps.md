---
about: "lydite's core-observability component builds common, redaction and resilience before its suite; workspace-deps-resolve-through-dist-only describes two"
saw:
  - .lydite/components.yml
  - source/core/packages/observability/package.json
targets: workspace-deps-resolve-through-dist-only
verdict: still-true
---
The rule still holds, but the example is stale: observability depends on `@vipengele/ts-core-resilience` (`workspace:*`, package.json `dependencies`), and the `core-observability` block in .lydite/components.yml lists `depends_on: [core-common, core-redaction, core-resilience]` with three `pnpm --filter ... run build` setup lines, not two. Its line anchors shift accordingly.
