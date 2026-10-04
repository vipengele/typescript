---
about: The local date-time types hold years 1-9999 only and split their errors by entry point (of throws InvalidDateTimeError, parse throws DateTimeParseError); now() re-reads the zone on every call, floors the clock, and maps BC eras to proleptic years
saw:
  - source/core/packages/common/src/types/date-time/local-date.ts
  - source/core/packages/common/src/types/date-time/local-date-time.ts
  - source/core/packages/common/src/types/date-time/now.ts
  - source/core/packages/common/src/types/date-time/now.test.ts
  - source/core/packages/common/src/types/date-time/properties.test.ts
  - source/core/packages/common/src/types/date-time/civil.ts
---

- `LocalDate` holds years 1 to 9999 (`MIN_YEAR`/`MAX_YEAR` in `local-date.ts`), so every value has a four-digit ISO form and
  parse/format round-trips. `of` rejects year 0 and 10000, and `plusDays`/`plusMonths` throw `InvalidDateTimeError` when the
  result leaves the range, because they build the result through `of`. A non-safe-integer amount is a `RangeError`, not a
  date-time error.
- The two errors never overlap: `of`/`ofFields` throw `InvalidDateTimeError`; `parse` throws `DateTimeParseError` for every bad
  string, including a well-shaped one with impossible fields (`2026-02-30`). `LocalDateTime.parse` delegates to
  `LocalDate.tryParse` and `LocalTime.tryParse`, so it can never surface `InvalidDateTimeError`. `LocalDateTime.of(date, time)`
  cannot throw (both parts are already valid); only `ofFields` can.
- `civil.ts` is plain integer arithmetic (days-from-civil / civil-from-days); no `Date` or zone is involved, and it is not
  exported from `index.ts` (the index test pins the export list).
- `now.ts` (`civilNow`) is the only zone-aware code. It reads `new Intl.DateTimeFormat().resolvedOptions().timeZone` on every
  call and keeps a formatter per zone in a module `Map`; a cache keyed by zone cannot go stale when the zone changes. The
  format is forced to `en-US`, `gregory`, `latn`, `hourCycle: "h23"` (midnight is hour 0, not 24) and `era: "short"`: without
  the era part, 1 BC formats as year 1 and would silently become a valid AD date, so a `BC` era maps to `1 - eraYear` and
  then fails `LocalDate.of`. The millisecond field is the floored instant's positive modulo 1000, never read from Intl.
- `Clock` (`time/clock.ts`) returns a fractional epoch (`performance.timeOrigin + performance.now()`), so `civilNow` floors it;
  a non-finite value or one beyond +-8.64e15 is a `RangeError`.
- `now.test.ts` pins the zone by spying on `Intl.DateTimeFormat.prototype.resolvedOptions`, which the cached formatter never
  calls, and pins the default clock by spying on `performance.now`. No `process.env.TZ` is touched, so the suite is identical
  in node and chromium.
- Biome's `noSecrets` also flags a PascalCase type name used as a test title (`"LocalDateTime"`); `properties.test.ts` words
  it as "date-times".
