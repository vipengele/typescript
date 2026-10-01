---
about: the logger core's shape — shared globalThis slots, identity-keyed memos, the frozen Logging facade, and what the test runtimes cannot simulate
saw:
  - docs/adr/0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md
  - source/core/packages/observability/src/logger/slots.ts
  - source/core/packages/observability/src/logger/levels.ts
  - source/core/packages/observability/src/logger/logging.ts
  - source/core/packages/observability/src/logger/logging.test.ts
  - source/core/packages/observability/src/logger/spec.test.ts
  - source/core/packages/common/src/levels/severity.ts
---
Cost: working out the slot protocol, the cache contract and the lint/test-runtime limits by building them.

- The levels slot (`Symbol.for('vipengele.logger.levels')`) holds a plain table of category to `{ level, severity }`;
  the default provider sits behind `Symbol.for('vipengele.logger.provider.v1')`. Both keys are dotted, unlike the
  colon-style key in common's `context/global-registry.ts`; `slots.ts` records ADR-0005 as the reason. Both are created
  lazily inside functions, never at module load.
- Tables are replaced, never mutated: `resolveEntry` (levels.ts) memoises per table identity in a WeakMap, and
  `normalizeTable` (slots.ts) caches its result per published table identity too. Mutating a published table leaves both
  caches stale. `publishLevelTable` stores a frozen, prototype-less copy.
- An entry with a level name this copy does not know resolves by its carried `severity` to the nearest known level at or
  above it (never "everything on"); a malformed entry falls back to `warn`.
- `Object.hasOwn` guards every lookup (`isLevel` in common's severity.ts, `resolveEntry`), so `constructor` and
  `__proto__` are not levels. `__proto__` is a valid category name, so category-keyed objects are built with
  `Object.create(null)`.
- `Logging` is a frozen object, not a static class: biome lint rejects static-only classes under `--error-on-warnings`.
- The warn target (`setWarnTarget`) is per-copy module state, so a `configure` through another copy's default provider
  reports through that copy's target.
- Under Vitest's Chromium project `vi.resetModules` does not yield a second module instance, so `logging.test.ts`
  simulates a second copy by wiring a provider like the default one and writing the slots directly. Vitest isolates per
  file, not per test, so tests delete both symbol properties in `afterEach`.
- In `spec.test.ts` the `__proto__` key is read through a variable: biome's `useLiteralKeys` and
  `noDeprecatedProperty` flag the literal forms.
