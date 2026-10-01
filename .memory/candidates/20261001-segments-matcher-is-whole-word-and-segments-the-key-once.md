---
about: the `{ segments }` KeyMatcher matches whole words only, so secretKeys misses plurals and run-together spellings, and matchKey() segments the key at most once per call through a shared lazy getter
saw:
  - source/core/packages/redaction/src/key-matcher.ts
  - source/core/packages/redaction/src/secret-keys.ts
  - docs/adr/0011-redaction-presets-and-exceptions.md
---

`{ segments: "token" }` matches a key whose lower-cased word segments contain the spec's segments
contiguously (`csrfToken`, `refresh_token`), not a substring, so `tokenizer` is untouched. The
flip side is deliberate and recorded in ADR-0011 and the README Caveats: `credentials`, `tokens`,
`apikey`, `sessionid` and `clientsecret` are single segments that differ from the preset's
`credential`, `token`, `api key` and `session`, so `secretKeys` does not redact them; an application
lists the spellings its data uses. A panel review flagged this as a data-exposure risk; the
tokenization is permanent public API, so widening it is a contract change, not a patch.

`matchKey()` hands every matcher in `keys` and `except` one memoized getter for the key's segments
(`NormalizedMatcher` is `(key, segments) => boolean`), so a policy of 13 `{ segments }` matchers
segments each key once, and a policy with none never segments it. `key-matcher.test.ts` observes
this by spying on `String.prototype[Symbol.iterator]`, which only `segment()` uses; a new matcher
that iterates the key with `for...of` would break those counts.
