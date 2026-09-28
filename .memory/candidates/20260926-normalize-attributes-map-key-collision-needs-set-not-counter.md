---
about: disambiguating Map keys that stringify to the same value in normalizeAttributes needs a Set of already-emitted output keys, not a per-base-key repeat counter
saw:
  - source/core/packages/common/src/attributes/normalize-attributes.ts
  - source/core/packages/common/src/attributes/normalize-attributes.test.ts
---

Found via two successive `panel-code-review` passes while landing issue #14 slice 1.

`normalizeMap` converts a `Map` into a plain object. Its keys are rarely strings, and
`Object.fromEntries(map)` coerces every key with `String()` — two distinct object keys with no
custom `toString` both become `"[object Object]"` and silently overwrite one another (no
sentinel, no trace).

The first fix stringified each key and, on a repeat of the same base string, appended
`#<n>` from a `Map<string, number>` counter keyed by the *base* string. That still collides: a
generated key like `"dup#1"` can match a real, literal Map key that happens to already look
generated (e.g. keys `{toString: () => "dup"}`, then the literal string `"dup#1"`, then another
`{toString: () => "dup"}`). The counter has no way to know `"dup#1"` was already taken by
something else.

The correct approach tracks the set of **output keys already emitted** (`Set<string>`), and on
a collision keeps raising the `#<n>` suffix until the candidate string isn't in that set yet —
checking against reality, not against a per-base-key counter that only tracks collisions it
caused itself.
