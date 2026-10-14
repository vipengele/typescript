---
about: "constraints for a logger test sink (issue #31): sink contract, frozen shared records, createTestTransport as only precedent, no ./testing in observability, no sink flush/close"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/errors/transports/test-transport.ts
  - source/core/packages/observability/src/logger/index.ts
  - source/core/packages/observability/tsup.config.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
  - docs/adr/0010-the-transport-contract-is-fire-and-forget.md
---
- Sink is `{ write(record, resource): void }` only (record.ts:36-38); no flush/close, ADR-0017 "Consequences" defers them. Sync throw is caught per sink -> onSinkError (emit.ts, last loop); returned promise ignored.
- Sink receives the record after built-in redaction and after global then per-sink processors; the SAME deeply frozen object goes to every sink (createRecord/freezeDeep in emit.ts; ADR-0017). Resource is a shared per-record read, second arg.
- createTestTransport (errors/transports/test-transport.ts) is the only precedent: parallel `events`/`resources` arrays, `clear()` that keeps closed state, no `find`. Neither ADR-0010 nor any note records a rationale beyond "the test transport records it in `resources`, parallel to `events`". No test sink / capture sink for the logger exists in docs, ADRs, CONTEXT.md or memory; ADR-0005 only sketches `addSink(testSink)` with `Logging.createProvider`.
- Observability has no ./testing sub-path: package.json exports only ./logger, ./errors; tsup entries are those two index files. createTestTransport is exported from the errors index directly (errors/index.ts:21). Package is sideEffects:false.
- Test isolation: default provider lives in a globalThis slot; use Logging.createProvider for isolated providers (ADR-0005). Fresh-copy tests need query-string import (see candidate 20261011-logger-slots-and-logging-tests-load-fresh-copies-by-query-import).
