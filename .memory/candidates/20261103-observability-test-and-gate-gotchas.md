---
about: "gates for new delivery code: lydite CRAP<=30 charges nested closures to the enclosing function; 100% coverage across node+chromium; browser-only APIs via injected targets plus *.browser.test.ts"
saw:
  - source/core/vitest.shared.ts
  - source/core/packages/observability/src/delivery/unload.browser.test.ts
  - source/core/packages/observability/src/delivery/unload.test.ts
  - handoff/done/20261030-0325-otlp-error-transport.md
  - .lydite/components.yml
---
- CRAP: `lydite test` must report `0 function(s) above 30` for core-observability; a nested closure's complexity is charged to
  its enclosing function (slice 1 hit 57 on `createDelivery`); keep helpers at module level (handoff/done/...otlp-error-transport.md:85,109-111).
  Delivery.ts already uses a class `DeliveryQueue` with private methods for this reason.
- vitest.shared.ts:15-60: thresholds 100% statements/branches/functions/lines, coverage = union of node and chromium; `*.node.test.ts`
  / `*.browser.test.ts` select one runtime. IndexedDB exists in Chromium but not Node: no suite uses it yet (grep indexedDB: 0 hits),
  so a Node-run suite needs an injected store interface (as `lifecycle: LifecycleTargets` injects fake targets, unload.ts:19-24;
  unload.test.ts runs in both runtimes with fakes, unload.browser.test.ts:6-8 uses the real window/document). Any
  default-IndexedDB branch is reachable only in chromium; the union rule is what makes that fine.
