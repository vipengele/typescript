---
about: ZoneId derives offsets by differencing civil fields at the zone and at UTC (never Date), rejects offset-style ids itself, and Instant prints years outside 0000-9999 in ISO expanded form because the Local types have no such convention
saw:
  - source/core/packages/common/src/types/date-time/zone-id.ts
  - source/core/packages/common/src/types/date-time/civil-fields.ts
  - source/core/packages/common/src/types/date-time/instant.ts
  - source/core/packages/common/src/types/date-time/index.test.ts
---

- `ZoneId#offsetSecondsAt` in `zone-id.ts` is `civilSeconds(civilFieldsAt(id, ms)) - civilSeconds(civilFieldsAt("UTC", ms))`, where
  `civilSeconds` is `daysFromCivil(...) * 86400 + h*3600 + m*60 + s` from `civil.ts`. It never builds a `Date`, so years 0 to 99 do
  not shift to 1900 to 1999, and it does not throw for a BC or year-10000 instant because `civil.ts` handles year 0 and 10000.
  The epoch it passes is `toEpochSecond() * 1000`: exact within the range (8.64e12 s times 1000 is under 2^53), and the offset
  ignores the fraction. Verified in node and chromium: Berlin 1880 is 3208 s (local mean time carries seconds).
- `ZoneId.of` validates by constructing `new Intl.DateTimeFormat("en-US", { timeZone: id })` and storing
  `resolvedOptions().timeZone`; Intl accepts offset ids (`+05:30`) and `Z` is rejected only by Intl, so `zone-id.ts` rejects the
  offset shape with `OFFSET_PATTERN` before Intl is asked. Without that regexp `ZoneId.of("+05:30")` would succeed.
- `civil-fields.ts` is the only `Intl.DateTimeFormat` cache; `ZoneId` must call `civilFieldsAt` rather than build a formatter,
  or the per-zone cache invariant `civil-fields.test.ts` checks (one construction per zone) stops holding.
- `Instant` (`instant.ts`) prints a year outside 0000 to 9999 as a sign and six digits (`+275760-09-13T00:00:00Z`), the form
  `Date#toISOString` writes, because `LocalDate` only holds 1 to 9999 and offers no expanded-year convention. Its range
  (`MAX_EPOCH_SECOND = 8_640_000_000_000`) is `Date`'s; at exactly the upper second only a zero nano is in range.
- `date-time/index.test.ts` pins the exported key set of the sub-path, so a new export from `errors.ts` or a new module fails it
  until `index.ts` and that test list it; `civil.ts`, `civil-fields.ts` and `fraction.ts` are deliberately not exported.
