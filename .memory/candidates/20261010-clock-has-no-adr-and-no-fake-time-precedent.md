---
about: Clock is an undocumented-by-ADR plain function type; no fake-time or Scheduler precedent exists, and shipped test helpers have precedent (createTestTransport)
saw:
  - source/core/packages/common/src/time/clock.ts
  - source/core/packages/common/tsup.config.ts
  - source/core/vitest.shared.ts
  - docs/adr/0014-nanosecond-precision-for-date-time-values.md
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---
`Clock = () => number` (clock.ts:4), `systemClock` reads performance.timeOrigin + performance.now() (clock.ts:11).
No ADR is about Clock: ADR-0007 only says `time` comes "from an injectable clock", ADR-0014:7 says Clock stays an epoch-ms double.
`grep -rn "useFakeTimers\|vi.advance" source/core/packages` -> 0 hits; no setTimeout in shipped src (only tests, e.g. async-context-store.node.test.ts:8). No abort/AbortSignal code in common src beyond serialization/engine.ts unrelated hits.
Shipped test helpers already exist (createTestTransport in observability ./errors), so ./testing in dist is not new in kind.
Coverage: vitest.shared.ts thresholds 100% over src/**/*.ts excluding *.test.ts, union of node+chromium; manual-time.ts is covered like any src file.
