---
about: source/core/packages/common/src/types/numeric/locale-parts.ts
saw: 20260923
---

`de-CH`'s ICU grouping character, verified live against `Intl.NumberFormat("de-CH")` in both
Node and the Chromium vitest drives, is the plain ASCII apostrophe (U+0027) — not U+2019 (right
single quotation mark), which is a common but wrong assumption about this locale (an earlier
draft of the handoff that produced `locale-parts.ts` asserted U+2019 and was wrong). Confirm any
future claim about a locale's separator characters against a live `formatToParts` call rather
than trusting a written description, including this one — the code comment in
`locale-parts.ts` deliberately derives these at runtime rather than tabulating them, partly for
this reason.
