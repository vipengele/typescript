---
about: common already has injectable, uncached capability detection for async context (context/capabilities.ts); no runtime identity, no ./runtime sub-path, and process.runtime.name is never computed
saw:
  - source/core/packages/common/src/context/capabilities.ts
  - source/core/packages/common/src/scope/root.ts
  - source/core/packages/common/package.json
  - source/core/packages/common/tsup.config.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
---

Found while planning issue #13 (runtime detection).

- ADR-0004 mandates: one `exports` target per entry (`types`+`default`, no `node`/`browser` conditions); each capability (`%c`, ANSI colour, async context, `sendBeacon`, process exit hooks) detected on its own and cached on first need, never from one load-time `typeof window`/`process`; Node built-ins via `process.getBuiltinModule('node:…')` guarded by "is a function"; only `import type` may name `node:`; detection accepts an injected capability source so tests force other runtimes' branches. ADR says "A bundle check asserts no `node:` specifier reaches `dist/`" -- `grep -rn "node:" .github` finds nothing, so that check does not exist yet.
- `capabilities.ts` already implements the async-context half: `CapabilitySource` (injectable, `capabilities.ts:~25`), `resolveAsyncLocalStorage` (getBuiltinModule("node:async_hooks")), `resolveAsyncContextVariable`. Deliberately NOT cached (docstring: "each call reads source afresh") -- caching in a new ./runtime flag would have to sit on top of, or reuse, these; ADR-0004 says "cached", the existing code says not. Reconcile before duplicating.
- `scope/root.ts` `UNKNOWN_RESOURCE` leaves `process.runtime.name` undefined; nothing computes it (`grep runtime.name source` only root.ts and tests; root.test.ts uses "nodejs" as a literal fixture). ADR-0006:44 mentions Deno reached via getBuiltinModule.
- No `typeof window`/`typeof process` anywhere in common src (grep). No `./runtime` export: package.json exports list is ".", ./types/numeric, ./context, ./attributes, ./serialization, ./scope, ./package.json; tsup.config.ts `entry` lists each src/<x>/index.ts explicitly. A new sub-path touches package.json exports + tsup entry + README section (README's keywords/description already say "runtime detection"); no test asserts the export list (src/index.test.ts only checks root re-exports).
