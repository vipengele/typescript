---
about: "http url errors redact the input and carry no cause, because the platform URL TypeError holds the raw string"
saw:
  - source/core/packages/http/src/url.ts
  - source/core/packages/http/src/url.test.ts
---
`resolveUrl` (source/core/packages/http/src/url.ts) throws `HttpConfigError` with the input passed
through `redactUrl` for an unparseable URL, a protocol-relative `//host` and a relative path with no
base. The unparseable case deliberately attaches no `cause`: Node's `ERR_INVALID_URL` TypeError
keeps the raw string in an `input` property, which `serializeError` would walk into `data`,
so userinfo or `?access_token=` would reach a log line unredacted. url.test.ts asserts both the
redaction and `cause === undefined`. Re-adding the TypeError as cause reintroduces the leak.
