---
about: attribute thunks share one module-level re-entrancy flag, and the disabled-call heap test must discard any attempt a GC ran in
saw:
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/logger/hot-path.node.test.ts
  - docs/adr/0019-lazy-logger-attributes-run-once-per-written-record.md
---
Found while implementing lazy logger attributes (issue #30).

- `evaluateAttributes` (`logger/emit.ts`) guards every attributes thunk, per-call and bound, with
  one module-level `evaluating` flag. While any thunk runs, any other thunk on any logger of the
  same copy of the package gets `{}`; without it a thunk that logs recurses until a `RangeError`
  is caught at each frame and one call writes thousands of records. The flag is deliberately not
  behind a `globalThis` `Symbol.for` slot: it guards one synchronous stack, not state that must
  agree across copies, so a recursion through two resolved copies is not stopped (ADR-0019).
- A thunk failure (throw, re-entry, non-record result) yields `{}` for its layer and the record is
  still written; it is never reported to `onSinkError`. In `warn`/`error`/`fatal` a function in the
  `error` position is an error value, never a thunk: dispatch is `typeof === "function"` on the
  `attributes` argument only (`logger/logger.ts`).
- `Logger#with` keeps an ordered list of layers (`logger/logger.ts`, `childBindings`). Consecutive
  fixed layers, and a static layer after an already-evaluated thunk, merge into one at `with()`
  time so a chain of static `with` calls costs one layer per record. An unevaluated thunk layer
  stays its own entry, so `with(thunk).with({ x })` keeps `x` winning. A child of an unevaluated
  parent thunk evaluates it separately at its own first record, so parent and child can disagree.
- `hot-path.node.test.ts` cannot assert heap growth one-sidedly: a GC during the measured loop
  frees what the loop allocated and can make an allocating disabled call show small or negative
  growth (observed 1.7 MB, 4.8 MB, -3.4 MB across three attempts). The test observes GCs with a
  `PerformanceObserver` (`entryTypes: ["gc"]`), discards any attempt a GC started in, and needs
  one clean attempt under 256 KB.
