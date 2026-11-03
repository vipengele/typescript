---
about: "the offline store's maxEntries counts stored bodies (batches), not log entries, and both bounds span every key in the shared vipengele-otlp-offline database"
saw:
  - source/core/packages/observability/src/delivery/offline/store.ts
  - source/core/packages/observability/src/delivery/offline/wrapper.ts
---
`OfflineLimits.maxEntries` (store.ts) is checked by `fitsLimits` against `usageOf(records).entries`, the number of stored
records; each body counts once whatever its `count`. With the default of 30 (wrapper.ts) and delivery batches of up to
512 entries, counting log entries would make a full batch unstorable. `put` reads every record in the database
(`getAll`) before adding, so the bounds cover all keys (`${url}|logs`, `${url}|errors`, every URL) together, and other
tabs' writes are seen; a per-connection in-memory counter would miss them.
