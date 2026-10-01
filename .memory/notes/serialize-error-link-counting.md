---
name: serialize-error-link-counting
kind: gotcha
description: serializeError cuts at link 6 (outermost is link 0, MAX_LINKS 5) and replaces cut or circular errors with SerializedError-shaped markers, not omissions.
anchors:
  - path: source/core/packages/common/src/serialization/serialize-error.ts
    blob: b13292ab3903
confidence: verified
---

Each step into a `cause` or `errors` entry adds one link (`serialize-error.ts:112,116`);
`serializeLink` cuts when `links > MAX_LINKS` (5) (`:131`). A fixture that hits the cut needs seven
errors (outermost plus six causes). Cut and cycle are ordinary `SerializedError` values
(`type: "[Truncated]"` / `"[Circular]"`, `:32-34`), so consumers need no null check. `errors` arrays
are capped separately at `MAX_ERRORS` (100, `:29,84-87`) with a trailing `[Truncated]` entry; width
is not bounded by `MAX_LINKS`, so a wide-and-deep tree has no total node budget. Only errors on the
current path are circular (`path` Set); the same error reached as two siblings is serialized in
full twice.
