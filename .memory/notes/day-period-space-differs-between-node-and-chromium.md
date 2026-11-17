---
name: day-period-space-differs-between-node-and-chromium
kind: gotcha
description: The whitespace Intl writes before a 12-hour day period is U+202F in Node's ICU and a regular space in the Playwright Chromium, so no test may compare against a literal containing it.
anchors:
  - path: source/core/packages/common/src/types/date-time/locale-format.test.ts
    blob: 96da4893f450
  - path: source/core/packages/common/src/types/date-time/local-time.test.ts
    blob: b903d6762e08
  - path: source/core/packages/common/src/types/date-time/locale-format.ts
    blob: 733ce8e95c33
confidence: verified
---

The space before `AM`/`PM` in `en-US` comes from the runtime's ICU, not from this code: U+202F
under Node, U+0020 under the Playwright Chromium
(`source/core/packages/common/src/types/date-time/locale-format.test.ts:481`,
`local-time.test.ts:462`). On top of that, V8's `format` replaces U+202F with a regular space while
`formatToParts` keeps it (`locale-format.ts:675`).

Tests that must hold in both runtimes therefore compare segments to `format()` and to what parsing
accepts, or normalise whitespace first (`locale-format.test.ts:32`), never to a hard-coded string.
The explicit U+202F assertions are gated with `test.runIf(enUSSpace === " ")`
(`locale-format.test.ts:490`, `local-time.test.ts:477`). Parsing accepts any whitespace kind there
(`locale-format.ts:455-468`).
