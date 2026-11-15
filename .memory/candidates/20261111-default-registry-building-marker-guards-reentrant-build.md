---
about: "defaultRegistry marks the globalThis slot with a Symbol.for building marker while the first build runs, so a re-entrant call throws instead of creating a second registry the outer call would overwrite"
saw:
  - source/core/packages/resilience/src/registry/default-registry.ts
  - source/core/packages/resilience/src/registry/default-registry.test.ts
---
`defaultRegistry(build)` (default-registry.ts) assigns the real registry to `globalThis[Symbol.for("vipengele.resilience.registry.v1")]` only after `createRegistry` returns, so a failed first `build` leaves the slot empty (the catch sets it back to `undefined`). While `build` runs the slot holds `Symbol.for("vipengele.resilience.registry.v1.building")`; a call that finds that marker throws `ResilienceConfigError`. Without the marker, a `build` calling `defaultRegistry()` would create and store an inner registry that the outer call then replaces, orphaning any policy taken from it. The marker is a `Symbol.for` value so a second copy of the package recognises it too (default-registry.test.ts covers the query-string copy). Code reading the slot must treat the marker as "not ready", never as a registry.
