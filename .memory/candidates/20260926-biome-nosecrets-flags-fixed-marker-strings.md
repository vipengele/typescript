---
about: biome's lint/security/noSecrets rule flags fixed, high-entropy-looking marker strings (like a truncation suffix) as possible secrets, even though they carry no secret material
saw:
  - source/core/packages/common/src/attributes/normalize-attributes.ts
  - source/core/packages/common/src/attributes/normalize-attributes.test.ts
  - source/core/biome.json
---

Found while landing issue #14 slice 1: `pnpm lint` failed on the literal constant
`"…[truncated]"` (the string-truncation suffix `normalizeAttributes` appends to an over-length
string), flagged by `lint/security/noSecrets` purely because of the string's entropy, not
because it resembles a credential.

`source/core/biome.json` carries no existing `biome-ignore` comment anywhere in the repo to
follow as precedent for this rule. The fix used is a one-line `// biome-ignore
lint/security/noSecrets: <reason>` directly above the constant (and above the matching test
fixture constant), rather than a `biome.json` override — an override would be the alternative
if this pattern recurs often enough to be worth silencing repo-wide instead of file-by-file.
