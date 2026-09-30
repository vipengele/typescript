---
about: serializeError counts one link per followed cause edge or errors entry (the outermost error is link 0), and a cut chain or a cycle is replaced by a marker that keeps the SerializedError shape rather than an omitted field
saw:
  - source/core/packages/common/src/serialization/serialize-error.ts
---

`serializeLink` walks from the outermost error at `links = 0`; each recursive step into a `cause`
or an `errors` entry increments `links` by one before the callee checks it against `MAX_LINKS`
(5). So the outermost error plus five links below it serialize in full, and the sixth is where
the chain is cut. A caller building a fixture that means to hit the cut needs seven errors
(outermost plus six `cause`s): the seventh becomes the first one to read past the limit.

The cut and cycle cases are both spelled as ordinary `SerializedError` values —
`{ type: "[Truncated]", message: "the chain continues past 5 links" }` and
`{ type: "[Circular]", message: "an error already on this chain" }` — rather than `undefined` or
a thrown error, so every consumer of the chain (a transport, a formatter) can treat `cause` and
`errors` entries uniformly without a null check. `errors` arrays are separately capped at 100
entries per array (`MAX_ERRORS`), with the same `"[Truncated]"` shape summarising the rest; this
width cap is not itself bounded by `MAX_LINKS`, so a pathological wide-and-deep `errors` tree
still has no single node-count budget.

Only an error on the path from the outermost one to itself counts as circular (tracked via a
`Set` added to and deleted from around each node's recursion); the same error object reached
twice as siblings (e.g. two `cause`s pointing at one shared error) is not circular and is
serialized in full both times.
