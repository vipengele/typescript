---
name: redact-walks-error-fields-explicitly
kind: gotcha
description: redact() copies Error's name/message/stack/cause by hand because they are non-enumerable, and skips them in the generic walk so an assigned cause isn't redacted twice.
anchors:
  - path: source/core/packages/redaction/src/redact.ts
    blob: 96ae66956ec2
confidence: verified
---

`walkError` (`redact.ts:297`) copies `name`, `message`, `stack` and `cause` explicitly, then walks
own enumerable fields with `ERROR_OWN_FIELDS` (`redact.ts:286`) skipped. `Object.keys(new
Error("x"))` is `[]`, so a generic instance walk would return `{}` for a bare Error. The skip set is
needed because `err.cause = x` (plain assignment, unlike the `{ cause }` option) is enumerable and
would otherwise be walked twice, invoking a function `Replacement` twice and overwriting the first
result. Related: [[redact-cycle-guard-is-ancestor-path]].
