---
about: the clock is injected explicitly through a builder, not held in a globalThis slot; the Clock type and systemClock default live in common, and the globalThis rule covers only state that must be identical across package copies
saw:
  - source/core/packages/observability/src/errors/builder.ts
  - source/core/packages/common/src/time/clock.ts
  - .claude/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
---

The globalThis `Symbol.for` rule applies to state every copy of a package must agree on (context
carrier, logger level table, ADR-0005 default provider). The reporter's clock is per-Reporter,
set by `ReporterBuilder.clock(fn)` and defaulting to `systemClock`, so tests pass a fake clock and
there is no process-wide override. No rule or ADR asks for a global clock.

`common/src/time/clock.ts` holds the pure `Clock` type (`() => number`, epoch ms with a sub-ms
fraction) and `systemClock`, `performance.timeOrigin + performance.now()`. `performance` is used
directly (no `process.hrtime`), valid in Node 24 and browsers; ADR-0004 forbids load-time
`typeof window/process` checks. Observability re-exports the `Clock` type from `./errors`.
