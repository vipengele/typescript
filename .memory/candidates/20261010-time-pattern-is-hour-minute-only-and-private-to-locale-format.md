---
about: resolveTimePattern is hour+minute only; seconds, time segments and public am/pm labels do not exist, and no ADR or note covers them
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/local-time.ts
  - source/core/packages/common/src/types/date-time/local-date.ts
  - source/core/packages/common/src/locale/locale.ts
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/src/index.test.ts
---

Established while planning issue #134 (LocalTime segments). Read from code, plus a Node 22.22 probe of `Intl.DateTimeFormat#formatToParts`.

- Time pattern, `locale-format.ts:377-383` (`TimePattern { twelveHour, fields, literals, am, pm }`), built by `resolveTime` (`:488-526`) from `formatToParts` of two probe instants, 01:05 and 13:05 on 2026-02-03 UTC (`MORNING`/`AFTERNOON`, `:426-427`). Options are `hour:"2-digit", minute:"2-digit"`, `calendar:"gregory"`, `numberingSystem:"latn"`, `timeZone:"UTC"`, `hourCycle` (`:470-479`). There is no `second` option, so seconds are never in the pattern and `format` never writes them (`formatTime` `:544-557`; the `LocalTime#format` doc at `local-time.ts:189-192` says so and parse zeroes second/nanosecond, `:51-58`). `TimeField` is `"hour"|"minute"|"dayPeriod"` (`:360`).
- am/pm text is the joined `dayPeriod` parts of the morning and afternoon probes (`:481-499`), empty strings on a 24-hour clock.
- Cache: module-level `Map`, `TIME_CACHE` (`:439`), keyed `${tag} ${h12|h23}` (`:466-468`), NOT a globalThis slot. The date cache comment (`:123-127`) says a second module copy recomputing is harmless, so the shared-realm-state rule does not apply.
- Hour cycle: `clockCycle` (`:462-464`) collapses `locale.uses24Hour` to h12/h23, so `-u-hc-h11/h24` become h12/h23. A `-u-hc-` tag is honoured through `Locale#hourCycle` (`locale.ts:75-84`, from `resolvedOptions`). There is no separate hourCycle option. Tests: `locale-format.test.ts:398-403, 444-447`.
- Literals keep bidi marks and U+202F verbatim. Parsing strips bidi marks and treats whitespace runs as any whitespace, case-folded (`spacedTokens` `:447-454`). Probe in Node 22: en-US h12 literal before PM is U+202F; ar-EG h12 gives `01:05 م` with a plain space and no bidi marks; ko-KR/ja-JP put dayPeriod first (ko-KR with a space after, ja-JP none). The part type is `dayPeriod` (camel case) in all of these.
- `LocalDate#segments(locale = Locale.default())` is an instance method (`local-date.ts:269-271`) because segment `value`s are this date's own padded digits (`dateSegments` `locale-format.ts:314-327`). `DateSegment { type, value }`, not `text`. Empty literals are omitted, so the values joined equal `format`. `DateSegmentType = DateField | "literal"` (`:299`). `DateSegment`/`DateSegmentType` are re-exported from `local-date.ts:12` and `date-time/index.ts:14`. No ADR records the segments decision. ADR-0013 only says Locale carries month/weekday names, hour cycle and first day (`docs/adr/0013-locale-replaces-the-string-locale.md:21-26`), and ADR-0015 is about DST. `Locale` memoises names lazily in private fields/Maps (`locale.ts:53-57, 92-112`).
- Adding exports: the umbrella lists names individually (`source/ts/packages/ts/src/index.ts:21-22`, pinned by `index.test.ts:23-24, 120-131`), plus docs sentences in `agentic/vipengele-typescript.md:79`, `source/ts/packages/ts/README.md:11`, `source/core/packages/common/README.md:259-270`, `source/core/packages/common/AGENTS.md:60`. Coverage is 100% on statements/branches/functions/lines over the union of node and chromium (`source/core/vitest.shared.ts:13-24`).
- Searched docs/, .memory/, agentic/ for segments/time segments: nothing tried or rejected before.
