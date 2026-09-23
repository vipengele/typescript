---
name: ascii-equivalents-keys-are-lookalike-codepoints
kind: gotcha
description: parse.ts ASCII_EQUIVALENTS has keys that render identically but are distinct codepoints; never edit it by eye.
anchors:
  - path: source/core/packages/common/src/types/numeric/parse.ts
    blob: 64472018e204
confidence: verified
---

`ASCII_EQUIVALENTS` (`source/core/packages/common/src/types/numeric/parse.ts:28-38`) holds four
space entries that look like one entry repeated four times in an editor. They are four
different codepoints:

- `parse.ts:32` U+00A0 no-break space
- `parse.ts:33` / `:34` U+202F narrow no-break space and U+2009 thin space
- `parse.ts:35` U+2007 figure space

The dashes at `parse.ts:29-31` (U+2212, U+2013, U+2010) and the apostrophes at `parse.ts:36-37`
(U+2019, U+02BC) have the same problem.

A `Map` literal takes a repeated key without complaint, and a missing key fails nothing at build
time. So if someone "dedupes" what looks like a copied line, or pastes a new separator using the
wrong lookalike, it compiles, lints and usually passes tests. The only symptom is that `parse`
rejects one locale's ASCII-retyped input at runtime. When you change this map, compare
codepoints (`[...s].map(c => c.codePointAt(0).toString(16))`, or a ripgrep `\x{202F}` search),
not glyphs.

Related: the separators a locale actually emits are read from `Intl` at runtime and never
hardcoded (`locale-parts.ts:32-37`), because they change between ICU versions. For example,
`de-CH`'s group character is read live in `parse.test.ts:15-20`.
