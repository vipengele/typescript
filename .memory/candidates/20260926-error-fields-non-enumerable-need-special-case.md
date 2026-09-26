---
about: redact() special-cases Error's name/message/stack/cause because V8 makes them non-enumerable, so a generic own-enumerable-keys walk silently returns {} for a bare Error
saw:
  - source/core/packages/redaction/src/redact.ts
---

`walkError()` (`source/core/packages/redaction/src/redact.ts:105-122`) explicitly copies `name`,
`message`, `stack`, and `cause` (when present) before running the generic `Object.keys()` walk
that picks up a subclass's own fields (e.g. `code` on a `VipengeleError`). Without this, `Object
.keys(new Error("x"))` returns `[]` — those four properties are non-enumerable on `Error.prototype`
instances in V8 — so a fully generic instance-walk (the same one used for every other class
instance) would produce `{}` for a bare `Error`, discarding everything that describes the failure.

A `plan-reviewer` pass on the draft plan (issue #18) caught this before implementation: an
earlier draft put `Error` on the fully generic instance-walk path with no special case.

Related gotcha: if `cause` was set by plain assignment (`err.cause = x`) rather than the
`{ cause }` constructor option, it *is* enumerable, so `Object.keys()` includes it. `walkError`
therefore excludes `name`/`message`/`stack`/`cause` from its generic walk via an explicit
`ERROR_OWN_FIELDS` skip set — otherwise an assigned `cause` would be walked (and any matching key
inside it redacted) twice, and a function `Replacement` for a matched value in it would be
invoked twice, silently overwriting the first result.
