---
about: Clock is a plain function type with no ADR of its own; Scheduler sits beside it in the package root, the only shipped timers and AbortSignal handling live in scheduler.ts and manual-time.ts, and shipped test helpers have precedent (createTestTransport)
saw:
  - source/core/packages/common/src/time/clock.ts
  - source/core/packages/common/src/time/scheduler.ts
  - source/core/packages/common/src/testing/manual-time.ts
  - source/core/packages/common/tsup.config.ts
  - source/core/vitest.shared.ts
  - docs/adr/0014-nanosecond-precision-for-date-time-values.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
- `Clock = () => number` (`clock.ts`); `systemClock` reads `performance.timeOrigin + performance.now()`. No ADR is about Clock: ADR-0007 only says `time` comes "from an injectable clock", and ADR-0014 says Clock stays an epoch-ms double. `Scheduler` has no ADR or glossary entry either.
- `Scheduler { sleep(ms, signal?) }` and `systemScheduler` (`scheduler.ts`) are exported from the package root next to `Clock`; `createManualTime` is only under `./testing`, and `index.test.ts` asserts it is not reachable from the root. The umbrella `@vipengele/ts` re-exports neither `Clock` nor `Scheduler`.
- `scheduler.ts` and `manual-time.ts` are the only shipped `src` files that use `setTimeout` or handle an `AbortSignal`. A sleep rejects with `signal.reason`, and a bad `ms` rejects with `RangeError` rather than a `VipengeleError` subclass.
- `createManualTime` patches no globals. Its `advance` hops through a real `setTimeout(0)` after each firing, so under `vi.useFakeTimers()` it never settles; no test in the repo uses fake timers, and manual time is the substitute.
- Shipped test helpers already exist (`createTestTransport` in observability `./errors`), so `./testing` in `dist` is not new in kind.
- Coverage: `vitest.shared.ts` gates 100% over `src/**/*.ts` excluding `*.test.ts`, as the union of node and chromium, so `manual-time.ts` is covered like any other src file.
