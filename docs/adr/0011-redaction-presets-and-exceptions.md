# Redaction presets are plain policies; exceptions are a policy field and keys match by word segment

`RedactionPolicy` has an optional `except` beside `keys`:

```ts
interface RedactionPolicy {
  keys: readonly KeyMatcher[];
  except?: readonly KeyMatcher[];
}
```

A key is redacted if and only if a `keys` matcher matches it and no `except` matcher does.

`KeyMatcher` has an inline word-segment form, `{ segments: string }`. The key and the spec are
tokenized alike: split on every character that is not a letter or a digit, on a lower-to-upper case
change, and before the last capital of an acronym run; every run of digits is its own segment; every
segment is lower-cased. The spec matches when its segments are contiguous among the key's, so
`{ segments: "api key" }` matches `APIKey`, `x-api-key` and `apiKeyId` but not `api_secret_key`. A
spec with no segments matches nothing. The form is always case-insensitive. Splitting is done with
fixed one-character Unicode class tests, never a pattern built from a key or a spec, so there is
nothing to backtrack. Digits are their own segment so that
`session2` still matches `session`: the bias is to fail closed.

A preset is a plain `RedactionPolicy`. `secretKeys` is a frozen singleton of `{ segments }` matchers
for `password`, `passwd`, `pwd`, `secret`, `token`, `authorization`, `cookie`, `api key`,
`private key`, `access key`, `session`, `credential` and `bearer`. Bare `auth` and `key` are left
out as too broad: they match `authMode` and `primaryKey`. `composePolicies(...parts)` concatenates
the parts' `keys` and their `except` into a new frozen policy and never mutates a part. `except` is
policy-wide after composition, so an exemption from one part also exempts a key another part
matches. Both are root exports of `@vipengele/ts-core-redaction`, re-exported by `@vipengele/ts`.

Because `composePolicies` returns a new object and a policy is normalized once per object identity
(a `WeakMap`), a caller composes once at startup and reuses the result. The `{ segments }`
tokenization is public API: changing where it splits changes which keys a policy redacts.

## Considered options

- **Substring or regular-expression defaults.** A substring `token` also matches `tokenizer`, and
  a regular expression that avoids that is one every application would have to read and trust.
  Whole-word matching gives the defaults a meaning that can be stated in one line. Its cost is
  that plurals and run-together spellings (`credentials`, `apikey`, `sessionid`) are not covered
  by the preset, and an application lists the spellings its data uses.
- **A separate `Preset` type.** A preset is a set of keys to redact, which is what a policy is.
  A second type would need its own composition rules and its own way into `redact`.
- **A sub-path export.** The surface is two names. Like `redact`, they are root exports, and a
  bundler already drops what a consumer does not import.
- **`except` as a wrapper or filter around `redact`.** It would not compose: a preset could not
  carry its own exemptions, and the policy would be split across two arguments.
- **Accept `tokenCount` matching `token` as a cost of the defaults.** Redacting a harmless key is
  the safe failure, but an application should not have to give up the preset to stop it. It lists
  `tokenCount` in `except` instead.
