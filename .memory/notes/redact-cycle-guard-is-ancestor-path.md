---
name: redact-cycle-guard-is-ancestor-path
kind: rationale
description: redact() marks "[Circular]" only for containers on the current recursion path, because a visited-set would mislabel a shared non-cyclic reference.
anchors:
  - path: source/core/packages/redaction/src/redact.ts
    blob: 96ae66956ec2
confidence: verified
---

`walk()` (`redact.ts:111-123`) adds a container to `context.ancestors` on entry and deletes it in
`finally` on exit (`:117-122`). A visited-forever set (the first design, caught in plan review of issue #18)
would turn `{ x: shared, y: shared }`'s second `shared` into `"[Circular]"` though nothing loops.
With the path version `shared` is walked and redacted independently under both keys. The `cycles`
tests in `redact.test.ts` cover both cases.
