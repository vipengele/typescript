---
about: Localized date, time and date-time text is derived from Intl.DateTimeFormat#formatToParts per locale (Gregorian, latn digits forced), cached per locale.tag; time digits are produced by our code so hour 24 cannot appear, and the layout is read from formatToParts because V8's format() rewrites U+202F
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/locale-format.test.ts
  - source/core/packages/common/src/types/date-time/local-date.ts
  - source/core/packages/common/src/types/date-time/properties.test.ts
  - docs/adr/0013-locale-replaces-the-string-locale.md
---

- `locale-format.ts` is the one place a locale's date, time and date-time pattern is read, from
  `Intl.DateTimeFormat(tag, { calendar: "gregory", numberingSystem: "latn", ... }).formatToParts(...)`; there are no per-locale
  tables. Forcing `gregory` and `latn` is what keeps `th-TH` from counting Buddhist years and `fa-IR` from counting Persian ones.
  The date pattern asks for a `2-digit` month and day because `numeric` changes the separators in some locales (`sr-RS`).
- The pattern caches (`CACHE`, `TIME_CACHE`, `DATE_TIME_CACHE`) are module-level `Map`s keyed by `locale.tag` (time and date-time
  also by cycle). They are not behind a `globalThis` slot: a cache of derived data that a second copy of the package recomputes
  harmlessly does not need to be shared, unlike a carrier or the logger's level table.
- The time pattern takes only literals and the AM/PM `dayPeriod` text from Intl; the digits are written by `formatTime`, on `h12`
  for a locale whose cycle is `h11`/`h12` and `h23` for `h23`/`h24` (`clockCycle`). Hour 24 therefore cannot be printed, and
  midnight is `00:00` whatever the engine's `h24` behaviour. Localized time is hour and minute only, so `parseLocalized` returns
  second 0 and millisecond 0 and a round-trip zeroes both.
- The date-time layout (what joins the date and the time) is read from `formatToParts`, not `format()`: V8's `format()` turns
  U+202F before `PM` into a regular space and `formatToParts` keeps it. Pattern whitespace matches `\s+` (any whitespace), so a
  person typing a regular space still parses. When the combined output cannot be split into the date run and the time run, the
  layout falls back to date, one space, time.
- Parsing never builds a `RegExp` from locale data: a semgrep ReDoS rule fails CI on any `new RegExp(x)` whose `x` derives from a
  parameter, and lydite forbids suppressing it. `matchTokens` (`locale-format.ts`) reads a token list (`text`, `space`, `digits`,
  `dayPeriod`, `mark`) left to right without backtracking. A run token takes as much as is there up to its `max` but leaves the
  `min` of the same-kind tokens after it, so `\d{1,2}` before `\d{4}` reads `12026` as `1` and `2026`. Time literals and
  day-period markers fold case; date literals are exact.
- Tests that pin locale behaviour avoid `eu`: its time pattern differs between Node and Chromium (`vi`, time first, is the
  engine-stable one). A 12-hour or 24-hour pattern is forced on any locale with a `-u-hc-` tag extension, which `Locale#hourCycle`
  follows.
- Biome's `noSecrets` flags bidi-heavy string literals in tests; build them with `join` rather than adding a suppression.
