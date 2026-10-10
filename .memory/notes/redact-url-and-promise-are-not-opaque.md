---
name: redact-url-and-promise-are-not-opaque
kind: rationale
description: redact() deliberately keeps URL and Promise out of isOpaque() so they fail closed to {} instead of passing by reference.
anchors:
  - path: source/core/packages/redaction/src/redact.ts
    blob: 96ae66956ec2
confidence: verified
---

`isOpaque()` (`redact.ts:175-185`) passes Date, ArrayBuffer and views, RegExp and boxed primitives
through by reference, since their state is not in own enumerable keys. `URL` has that shape too but
is excluded (comment at `redact.ts:169-173`): its userinfo or query (`?access_token=`) can hold
credentials no `RedactionPolicy` key rule can name, so by-reference passthrough would leak them (a
security panel review of issue #18 caught the first version that included it). `Promise` is
excluded because proving a genuine one means calling `.then`, which attaches a handler. Both fall to
the generic walk and come back `{}`. Do not "fix" this to match RegExp.

`Headers` and `URLSearchParams` are not in `isOpaque()` either and keep their entries outside own
enumerable keys, so they also come back `{}` (`redact.ts:215`, `walkFields`). A `[name, value][]`
header list is walked as arrays, so the header name is a value and never matches a key rule. Use
`redactHeaders`, `redactUrl` or `redactQueryString` for those, not `redact`.
