---
name: vipengele-errors-never-set-name
kind: gotcha
description: No resilience error class, nor VipengeleError itself, assigns name, so error.name is "Error" and code is the only discriminator.
anchors:
  - path: source/core/packages/resilience/src/errors/resilience-errors.ts
    blob: c435cfc5c79d
  - path: source/core/packages/resilience/src/errors/resilience-errors.test.ts
    blob: 524bc2adf7dc
  - path: source/core/packages/common/src/errors/vipengele-error.ts
    blob: 2223e8e48c69
confidence: verified
---

Neither `source/core/packages/resilience/src/errors/resilience-errors.ts` nor
`source/core/packages/common/src/errors/vipengele-error.ts` assigns `name` (no `.name` in either
file), so `new BulkheadFullError(...).name === "Error"`.
`source/core/packages/resilience/src/errors/resilience-errors.test.ts:168,187` pins `"Error"`.

A plan or test that expects `name` to be the class name is wrong here; match on `code` through
the exported guards. For the same reason error detail fields avoid the key `name`, which
`Error#name` owns.
