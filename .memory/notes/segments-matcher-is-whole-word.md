---
name: segments-matcher-is-whole-word
kind: gotcha
description: The `{ segments }` key matcher matches whole words only, so secretKeys misses plurals and run-together spellings like apikey or sessionid.
anchors:
  - path: source/core/packages/redaction/src/key-matcher.ts
    blob: d040431262c8
  - path: source/core/packages/redaction/src/secret-keys.ts
    blob: c8cae28a6c52
confidence: verified
---

`{ segments: "token" }` matches `csrfToken` and `refresh_token` but not `tokenizer`
(`key-matcher.ts:6-12`). So `credentials`, `tokens`, `apikey`, `sessionid` and `clientsecret` are
single segments that differ from the preset's `credential`, `token`, `api key` and `session`
(`secret-keys.ts:15-32`), and `secretKeys` does not redact them; applications list the spellings
their data uses. Recorded in ADR-0011 and flagged by panel review as a data-exposure risk; the
tokenization is public API, so widening it is a contract change.

`matchKey()` gives all matchers one lazy segments getter (`key-matcher.ts:164`), so a key is
segmented at most once per call. `key-matcher.test.ts` counts this by spying on
`String.prototype[Symbol.iterator]`; a new matcher iterating the key with `for...of` breaks those
counts.
