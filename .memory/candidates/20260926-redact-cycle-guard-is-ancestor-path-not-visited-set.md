---
about: redact()'s cycle guard tracks only the containers on the current recursion path, not every container visited, because a naive "every object ever visited" WeakSet mislabels a shared non-cyclic reference as circular
saw:
  - source/core/packages/redaction/src/redact.ts
---

`walk()` (`source/core/packages/redaction/src/redact.ts:40-49`) adds a container to
`context.ancestors` (a `WeakSet`) on entering its recursive walk and deletes it in a `finally`
block on leaving. Only a container still in `ancestors` at the point it is re-encountered — i.e.
still its own ancestor — resolves to `"[Circular]"`.

A `plan-reviewer` pass on the draft plan (issue #18) caught that the original design used a
single "every object visited" `WeakSet` instead: add on first visit, never delete. That version
would have wrongly marked a shared, non-cyclic reference reachable from two sibling branches of
the same input (e.g. `{ x: shared, y: shared }`) as `"[Circular]"` on its second occurrence,
even though nothing loops. The ancestor-path version walks and redacts `shared` independently
under both `x` and `y`.

`redact.test.ts`'s "cycles" describe block tests both cases explicitly: true self-cycles
(object, array, class instance, and cycles through a Map/Set/Error-cause) resolve to
`"[Circular]"`, while a shared non-cyclic reference produces two independently-redacted,
non-identical copies.
