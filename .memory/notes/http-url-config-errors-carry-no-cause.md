---
name: http-url-config-errors-carry-no-cause
kind: gotcha
description: HttpConfigError for a bad URL redacts the input and deliberately attaches no cause, because the platform's URL TypeError keeps the raw string and serializeError would log it.
anchors:
  - path: source/core/packages/http/src/url.ts
    blob: cabbfb127abd
  - path: source/core/packages/http/src/url.test.ts
    blob: c5b9db3c6485
confidence: verified
---

`resolveUrl` in `source/core/packages/http/src/url.ts` throws `HttpConfigError` with a redacted
form of the input and no `cause` (the file never mentions `cause`).
`source/core/packages/http/src/url.test.ts:36-46` and `:146-152` assert both the redaction and
`cause === undefined`.

The reason, as the explorer recorded it: Node's `ERR_INVALID_URL` TypeError keeps the raw string
in an `input` property, which `serializeError` would walk into `data`, so userinfo or an
`?access_token=` would reach a log line unredacted. Attaching the TypeError as `cause` "for
debuggability" reintroduces the leak.

Any new config error that mentions a URL (a token endpoint, for example) should follow the same
rule: redact the text, attach no platform error.
