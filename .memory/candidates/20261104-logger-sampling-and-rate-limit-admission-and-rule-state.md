---
about: "where the logger's sampling and rate-limit check sits, where its per-rule state lives, and the spec-rebuild sites that silently drop a ParsedSpec field"
saw:
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/src/logger/emit.ts
  - source/core/packages/observability/src/logger/policy.ts
  - source/core/packages/observability/src/logger/provider.ts
  - source/core/packages/observability/src/logger/spec.ts
  - source/core/packages/observability/src/logger/browser-sources.ts
  - source/core/packages/observability/src/logger/environment-source.ts
  - source/core/packages/observability/src/logger/builder.ts
  - source/core/packages/observability/src/token-bucket.ts
  - docs/adr/0025-logger-sampling-and-rate-limits-drop-before-the-record-is-built.md
---
- The check runs in `bindLogger`'s `log` (`logger.ts`): level, then `settings.sinks.length === 0`, then `settings.policy.admit(category, level, random, clock)`, and only an admitted call reaches `emitRecord`. A drop there runs no thunk, Scope read or redaction (ADR-0025, ADR-0019). `confirm` in `provider.ts` calls `emitRecord` directly, so a console-handle confirmation is never sampled or limited.
- `LogPolicy#admit` (`policy.ts`) never throws: a throwing `random` or `clock` drops the record uncounted and takes no token. The clock is read only when a rate-limit rule covers the call, and that reading is passed through the `Admission` to `createRecord` as the record's `time` (`emit.ts`); without an admission time `createRecord` reads the clock itself.
- `vipengele.logger.dropped` is spread in after redaction in `createRecord`, so neither a caller attribute nor a redaction policy changes it. `emitRecord` calls `admission.settle()` right after `createRecord` returns and before processors run: a throwing build keeps the count, a processor drop loses it. `settle` subtracts what it reported rather than zeroing.
- Rule state (one `createTokenBucket` from `src/token-bucket.ts` plus a dropped counter per rule) lives in `LogPolicy.states`, keyed by `JSON.stringify([key, burst, perMinute, upTo])`. The provider's `apply()` builds `new LogPolicy(next.policy, emitSettings.policy)` on every commit, so a rule unchanged in key and value keeps its bucket across configure, override, the console handle and `settle`. No `globalThis` slot holds it; the level-table slot format (ADR-0005) is untouched.
- `ParsedSpec` carries `policy` beside `levels`/`issues`. Every site that rebuilds that object must copy it or the field is silently dropped: `parseLabelled` and the unreadable-stored branch in `browser-sources.ts`, `parseEnvironmentSpec` in `environment-source.ts`, and `addParsed` in `builder.ts`.
- `EmitSettings.policy` and `.random` (`record.ts`) are optional only because many test files build `EmitSettings` literals; the provider always sets both.
