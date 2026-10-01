---
about: the existing clock is injected explicitly through a builder, not held in a globalThis slot; the globalThis rule covers only state that must be identical across package copies
saw:
  - source/core/packages/observability/src/errors/builder.ts
  - .claude/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
---

The globalThis `Symbol.for` rule applies to state every copy of a package must agree on (context
carrier, logger level table, ADR-0005 default provider). The reporter's clock is per-Reporter,
set by `ReporterBuilder.clock(fn)` (builder.ts:35) and read from settings (`pipeline.clock()`,
pipeline.ts:72), so tests pass a fake clock and there is no process-wide override. No rule or ADR
asks for a global clock; a pure `Clock` type plus a default `performance.timeOrigin +
performance.now()` function in common fits the existing pattern. Inference from absence of any
rule, not a recorded decision. `performance` is used directly (no `process.hrtime`), valid in
Node 24 and browsers; ADR-0004 forbids load-time `typeof window/process` checks.
