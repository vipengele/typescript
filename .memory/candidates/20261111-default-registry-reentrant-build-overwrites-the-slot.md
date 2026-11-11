---
about: "defaultRegistry writes the globalThis slot only after createRegistry returns, so a build callback that itself calls defaultRegistry() fills the slot and is then overwritten by the outer call"
saw:
  - source/core/packages/resilience/src/registry/default-registry.ts
  - source/core/packages/resilience/src/registry/default-registry.test.ts
---
`defaultRegistry(build)` (default-registry.ts) reads `globalThis[Symbol.for("vipengele.resilience.registry.v1")]`, and when empty calls `createRegistry(...)` and assigns the slot afterwards. Writing after `createRegistry` returns is what keeps the slot empty when the first `build` throws (a test covers that), but it also means a `build` that calls `defaultRegistry()` re-entrantly creates and stores an inner registry, which the outer call then replaces. Policies taken from the inner registry during `build` belong to an orphaned registry. No guard and no test cover the re-entrant case; ADR-0029 decision 9 does not mention it.
