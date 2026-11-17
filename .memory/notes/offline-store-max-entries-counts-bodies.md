---
name: offline-store-max-entries-counts-bodies
kind: gotcha
description: The offline store's maxEntries counts stored request bodies (batches), not log entries, and both bounds span every key in the shared database.
anchors:
  - path: source/core/packages/observability/src/delivery/offline/store.ts
    blob: ce294ea71b04
  - path: source/core/packages/observability/src/delivery/offline/wrapper.ts
    blob: a75fd317e601
confidence: verified
---

In `source/core/packages/observability/src/delivery/offline/store.ts`, `fitsLimits` checks
`usage.entries + 1 <= limits.maxEntries` (`:69-70`), and `usageOf` (`:60`) counts stored records:
one per body, whatever number of log entries or events that body holds. Counting entries instead
would make a single full delivery batch unstorable under the default (`wrapper.ts:66`).

`put` reads every record in the database with `getAll()` before adding (`:101-104`), so the
bounds cover all keys and URLs together and see other tabs' writes. A per-connection in-memory
counter would be cheaper and wrong.
