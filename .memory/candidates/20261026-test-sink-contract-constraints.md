---
about: "constraints on a logger test sink: Sink is write(record, resource) only, records are frozen and shared across sinks, export surface is test-pinned"
saw:
  - source/core/packages/observability/src/logger/record.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/index.ts
  - source/core/packages/observability/src/logger/index.test.ts
  - source/core/packages/observability/src/errors/transports/test-transport.ts
  - source/core/packages/observability/tsup.config.ts
  - docs/adr/0017-logger-processors-fail-closed-after-built-in-redaction.md
---

Found while planning issue #31 (logger test sink). Read from code, no store note existed.

- Sink contract: `interface Sink { write(record, resource): void }` only (record.ts, Sink docblock). No flush/close; ADR-0017 "Consequences" explicitly defers Sink flush/close. Return value ignored, promise not awaited; sync throw caught per sink -> onSinkError (emit.ts, last loop of emitRecord). `(record, resource)` arity is part of the `vipengele.logger.provider.v1` protocol (ADR-0005).
- Records are deeply frozen (`freezeDeep` in emit.ts createRecord; processor outputs rebuilt + frozen, ADR-0017) and the SAME object goes to every sink unless a per-sink processor returns another. So a test sink can store the reference without copying; `resource` is one frozen object per record too.
- Category prefix: governingKeys (categories.ts) matches on `.` boundaries only (`react` never matches `reactive`); a find-by-category helper that wants prefix semantics should split on "." not use startsWith.
- Export surface is pinned: logger/index.test.ts asserts `Object.keys(entry).sort()` exactly, so a new runtime export must be added there. No `./testing` subpath exists in observability (package.json exports only ./logger, ./errors; tsup entries are only the two index.ts). createTestTransport is exported from ./errors, not a subpath. Coverage is 100% per package (vitest.shared.ts thresholds) in node+chromium.
