---
about: ./runtime memoises its detectors while ./context's capability resolvers read the source afresh each call; process.runtime.name is still not wired to the detector, and Runtime says "node" where OpenTelemetry says "nodejs"
saw:
  - source/core/packages/common/src/runtime/identity.ts
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/packages/common/src/context/capabilities.ts
  - source/core/packages/common/src/scope/root.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
---

- `./runtime` (`detectRuntime`, `detectCapability`) memoises in module state on first read and bypasses the memo when a `RuntimeSource` is injected; no `Symbol.for` slot, since every copy computes the same answer from the same realm. The reset seams (`resetDetectedRuntime`, `resetDetectedCapabilities`) and `globalRuntimeSource` are internal and not exported from `runtime/index.ts`.
- `context/capabilities.ts` (`CapabilitySource`, `resolveAsyncLocalStorage`, `resolveAsyncContextVariable`) is deliberately uncached ("each call reads source afresh"). `./runtime`'s `asyncContext` flag reuses those resolvers; `RuntimeSource` is assignable to `CapabilitySource`, which is left unchanged.
- `scope/root.ts` `UNKNOWN_RESOURCE` still leaves `process.runtime.name` undefined and nothing calls the detector. `Runtime` uses `"node"`, OpenTelemetry's value is `"nodejs"` (root.test.ts uses `"nodejs"` as a fixture), so wiring it needs a mapping.
- ADR-0004 mentions a post-build check that no `node:` specifier reaches `dist/`; `grep -rn "node:" .github` finds none, so it does not exist.
- `ansiColour` treats an empty `NO_COLOR` as unset and `FORCE_COLOR` of `"0"`/`"false"` as off; a `process.env` that throws on read counts as unset. `processExitHooks` needs both `process.on` and `process.getBuiltinModule` to be functions, since bundler `process` polyfills ship a no-op `on`.
