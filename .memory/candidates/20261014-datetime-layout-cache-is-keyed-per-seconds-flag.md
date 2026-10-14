---
about: the combined date-time layout is resolved and cached per (locale, clock cycle, seconds); a locale whose seconds output stops aligning silently gets the fallback layout
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/locale-format.test.ts
---

- `resolveDateTime(locale, seconds)` keys `DATE_TIME_CACHE` with `cacheKey(locale, cycle, seconds)`; `DATE_TIME_CACHE`
  is a separate map from the time-only cache, so the two never collide. `resolveDateTimeLayout`, `formatDateTime` and
  `parseDateTime` take a trailing `options: TimeOptions = {}`, the module's convention.
- `layoutDateTime` locates the time-only string inside Intl's combined output. When the runs do not line up it
  returns the fallback layout (date, space, time) without an error, so a wrong separator is the only symptom. Adding
  `second: "2-digit"` changes both outputs; the layout tests assert `toEqual` between the with-seconds and
  without-seconds layout across several locales rather than hard-coding Intl data.
