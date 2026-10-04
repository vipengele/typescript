---
about: No ADR, rule, note or glossary entry covers date/time types, Locale, Intl.Locale or getWeekInfo; the only time code is Clock, and missing-feature tests use injected sources
saw:
  - CONTEXT.md
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
  - source/core/packages/common/src/time/clock.ts
  - source/core/packages/common/src/runtime/capabilities.ts
  - source/core/vitest.shared.ts
---

- grep for getWeekInfo|weekInfo|Intl.Locale across the repo: 0 hits outside nothing relevant. CONTEXT.md has no Locale/date terms.
- `Clock = () => number`, `systemClock = performance.timeOrigin + performance.now()` (`time/clock.ts`), exported from the
  package root, documented in common README "Clock"; deliberately not `Date.now()` (wall clock is adjustable).
- Convention for exercising an absent feature: functions take an injected source (`detectCapability(cap, source?)`,
  `capabilities.ts:~95`; ADR-0004 last paragraph of first section) so a test forces branches the real runtime can't reach;
  node/chromium real branches are covered by the normal runs. Runtime-only suites are `*.node.test.ts`/`*.browser.test.ts`
  (`vitest.shared.ts` nodeOnly/browserOnly). No existing test stubs a `globalThis.Intl` member; a getWeekInfo fallback would
  need either an injected seam or a vi.stubGlobal, and 100% branch coverage applies to the union of both runs.
- ADR-0004 mandates feature detection, never load-time `typeof window`-style checks.
