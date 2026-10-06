---
about: No ADR or note records a Temporal/zone decision; the only trace is a handoff line ("No Temporal, no polyfill, no Date arithmetic") and the CONTEXT.md Local Value definition; zoned types inherit the Intl-only, 1-9999, private-ctor+freeze, code+guard conventions
saw:
  - handoff/done/20261004-0737-local-date-time-types.md
  - CONTEXT.md
  - docs/adr/0013-locale-replaces-the-string-locale.md
  - source/core/packages/common/src/types/date-time/now.ts
  - source/core/packages/common/src/types/date-time/errors.ts
  - source/core/packages/common/src/types/date-time/local-date-time.ts
  - source/ts/packages/ts/src/index.test.ts
  - source/core/vitest.shared.ts
---
- `grep -rni temporal` over docs/, CONTEXT.md, source: only the handoff (line 43) mentions it; no ADR covers date-time. ADR-0013 only fixes that locale-aware types take a `Locale`.
- CONTEXT.md "Local Value" (~l.147): zone consulted only by now(); "instant" is listed under _Avoid_ for Local Value, so Instant/ZonedDateTime need new glossary entries.
- Types: `private constructor` + `Object.freeze(this)` (local-date-time.ts:~55), years 1-9999 (see 20261004-date-time-types-range... candidate); errors are code+guard pairs (errors.ts), split by entry point (`of` vs `parse`).
- Intl pattern in now.ts: per-zone formatter cache, en-US/gregory/latn/h23, era:"short" else 1 BC reads as AD. No process.env.TZ in tests; zone pinned by spying `resolvedOptions`.
- Umbrella index.test.ts imports each name individually and has an identity test against core sub-path exports (l.65); new names need adding there, and umbrella resolves core via dist.
- vitest.shared.ts: 100% thresholds over node+chromium union; *.node.test.ts / *.browser.test.ts for single-runtime suites.
- Not verified: zone canonicalisation (Asia/Calcutta) and Chromium-vs-Node Intl differences; no note covers them.
