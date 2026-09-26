---
about: redact()'s isOpaque() deliberately excludes URL even though it has the same "state lives outside own enumerable keys" shape as RegExp/Promise/boxed primitives, because a URL can carry credentials no key rule could name
saw:
  - source/core/packages/redaction/src/redact.ts
---

`isOpaque()` (`source/core/packages/redaction/src/redact.ts:51-68`) passes `Date`, `ArrayBuffer`
and its views, `RegExp`, `Promise`, and boxed primitives (`String`/`Number`/`Boolean` wrapper
objects) through by reference, because their state lives in internal slots or prototype getters
rather than own enumerable keys — a generic instance-walk would silently return `{}` for them.

A first implementation of this fix (issue #18) also added `URL` to that list, since it has the
identical shape (an own-enumerable-keys walk on a `URL` instance returns `{}` too). A
`panel-code-review` security pass caught that this is unsafe: a `URL`'s userinfo
(`https://user:pass@host`) or query string (`?access_token=...`) can carry credentials, and no
`RedactionPolicy` key rule can name a URL component to redact it. Passing a `URL` through by
reference means those credentials reach whatever consumes the redacted output unchanged.

`URL` is therefore deliberately left off `isOpaque()` and falls through to the generic
class-instance walk instead, which returns `{}` (fail-closed) rather than leaking it by
reference. `redact.test.ts`'s pass-through-values tests assert this asymmetry explicitly: RegExp/
Promise/boxed-primitive values come back `===` the input, while a `URL` (even one carrying a
password and an `access_token` query param) comes back `{}`, not the same reference.
