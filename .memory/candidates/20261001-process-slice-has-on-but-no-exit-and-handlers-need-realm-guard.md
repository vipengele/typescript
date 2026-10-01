---
about: runtime detection types only model process.on, not exit/off; no precedent for idempotent install state, and two flush timeout conventions to note
saw:
  - source/core/packages/common/src/runtime/identity.ts
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/common/src/context/global-registry.ts
  - source/core/packages/observability/src/errors/transports/test-transport.ts
  - source/core/vitest.shared.ts
  - agentic/instructions/common-runtime-sub-path.md
---
- `RuntimeSource.process` is a structural slice with `getBuiltinModule`, `versions`, `env`, `stdout`
  and `on: unknown` only (identity.ts, comment: "the package type-checks without `@types/node`").
  No `exit`, `exitCode`, `off`/`removeListener`. A handler that exits or uninstalls must widen the
  slice or declare its own structural type; `tsconfig.base.json` has no `types`/`@types/node`.
- `detectCapability("processExitHooks")` (capabilities.ts:72) = `getBuiltinModule` AND `on` are
  functions, because a bundler `process` polyfill has a no-op `on`. Its doc says "runs as the
  process exits" but it is the right gate for `process.on("uncaughtException")` too. Tests inject a
  plain-object source (capabilities.test.ts:139-153); a browser run returns false
  (runtime.browser.test.ts:19). agentic/instructions/common-runtime-sub-path.md says ask
  `./runtime` before touching `window`/`process`.
- The only globalThis `Symbol.for` slot precedent is `getOrCreateRegistryEntry`
  (global-registry.ts:30) for the context carrier, plus the logger level table (ADR-0005). Nothing
  stores "installed" flags. The rule text (shared-realm-state...) covers "state that must be one
  value across all copies", so applying it to an installed-handlers guard is an inference, not a
  decision. Note a per-Reporter handler is NOT realm state: two copies each installing for the same
  reporter is the double-capture risk; two reporters installing is legitimate.
- Flush/close: `Reporter.flush/close(timeoutMs?)` delegate to the transport, resolve `true` with no
  transport (reporter.ts); transport contract `true` = delivered/dropped, `false` = timeout elapsed
  (transport.ts, ADR-0010). The test transport's flush/close always resolve true immediately
  (test-transport.ts). No default timeout value is defined anywhere (`grep -rn "timeoutMs"`): the
  caller-supplied number is the only convention. ADR-0010 says "close flushes" and rejects
  per-event promises specifically because "the Reporter would have to track every in-flight promise
  to know when it may exit", i.e. exit-after-flush is intended to be `await reporter.flush(t)`.
- Vitest: no repo note or config about unhandled errors. vitest.shared.ts has no
  `dangerouslyIgnoreUnhandledErrors`, and runs every `*.test.ts` in node and chromium projects,
  coverage 100% on both unioned. UNVERIFIED (from general Vitest behaviour, not run here): Vitest
  fails a run on unhandled errors/rejections it observes, so tests should drive handlers through an
  injected target/source rather than really emitting to `process`/`window`.
