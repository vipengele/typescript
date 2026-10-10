---
about: LocalTime#segments, LocalTime.dayPeriods, format and parse all read one cached time pattern per locale, hour cycle and seconds flag, so they cannot drift apart
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/local-time.ts
  - source/core/packages/common/src/types/date-time/locale-format.test.ts
  - source/core/packages/common/src/types/date-time/time-segments.consistency.test.ts
  - source/ts/packages/ts/src/index.ts
---

Established while implementing issue #134 (LocalTime segments). Read from code and from test runs under Node and Chromium.

- One resolver feeds everything. `resolveTime(locale, cycle, seconds)` in `locale-format.ts` builds a pattern from `Intl.DateTimeFormat#formatToParts` of two probe instants and caches it in the module-level `TIME_CACHE`, keyed `${tag} ${cycle} ${seconds}` (not a `globalThis` slot: a second module copy recomputing is harmless). `formatTime`, `parseTime`, `timeSegments`, `resolveTimePattern` and `LocalTime.dayPeriods` all read that pattern, so the labels, the segments and the parse accept-set come from the same object.
- `formatTime` is `timeSegments(...)` with the values joined. That makes `segments.map(s => s.value).join("") === format()` hold structurally rather than by test; the consistency test only guards it.
- `LocalTime.dayPeriods(locale)` calls `resolveTimePattern(locale, { hourCycle: "h12" })`, the forced-12-hour pattern, so a 24-hour locale (de-DE, plain ja-JP) still returns AM/PM labels. `formatTime`/`parseTime` take only `{ seconds }`, no cycle: the cycle is the locale's own via `clockCycle`, which collapses `h11`/`h24` to `h12`/`h23`.
- `LocalDateTime` stays hour-and-minute. `resolveDateTime` passes the locale's cycle and `seconds: false` explicitly and shares `timeFormatOptions`/`resolveTime`, so a change to the time probe options reaches date-time patterns too.
- Seconds are strict both ways: with `{ seconds: true }` a string without a second is rejected, without it a string with one is rejected. The second is a fixed two-digit field.
- The whitespace before a 12-hour day period depends on the runtime's ICU, not on the code: Node writes U+202F in en-US, the Playwright Chromium writes a regular space. Tests that hold in both runtimes compare segments to `format()` and to what `tryParseLocalized` accepts, never to a literal containing that space; the explicit U+202F assertions run only where `Intl` produces it (`test.runIf`).
- Adding an export still means the umbrella: `@vipengele/ts` lists type names individually in `source/ts/packages/ts/src/index.ts`, and the umbrella reads core's built `dist/` through its `link:` override, so core must be built before the umbrella type-checks.
