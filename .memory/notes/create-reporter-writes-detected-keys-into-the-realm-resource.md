---
name: create-reporter-writes-detected-keys-into-the-realm-resource
kind: gotcha
description: Every createReporter call fills detected runtime, OS, browser and device keys into the realm-wide Resource where unset, so a test that needs an all-undefined Resource must reset the attribute bag itself.
anchors:
  - path: source/core/packages/observability/src/errors/reporter.ts
    blob: c5a2b132e063
  - path: source/core/packages/common/src/scope/root.ts
    blob: f4ea48305e24
confidence: verified
---

`createReporter` calls `fillRuntimeContext()` on every construction
(`source/core/packages/observability/src/errors/reporter.ts:112`). It runs the runtime detector
and writes each detected key through `Scope.setResource`, only where the current value is
`undefined`, inside a try/catch (`:62-75`). An explicit `Scope.setResource`, before or after,
wins.

The Resource is realm-wide state on the Scope root, and `setResource` cannot clear a key
([[scope-root-defaults-to-unknown-resource]]). So any test that creates a reporter leaves
detected keys behind for later tests in the file. A test that needs an all-undefined Resource
resets the `Symbol.for("vipengele:scope:attributes")` bag on the root directly
(`source/core/packages/common/src/scope/root.ts:72`; the scope suites in
`source/core/packages/common/src/scope/` hold that symbol for the purpose, e.g.
`set-resource.test.ts:5`).

A logger-only application creates no reporter and gets no detected values.
