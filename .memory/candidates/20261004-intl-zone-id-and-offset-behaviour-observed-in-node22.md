---
about: What Intl does with zone ids and offsets (observed on Node 22.22 only, not Chromium) that a ZoneId/offset/atZone implementation must survive
saw:
  - source/core/packages/common/src/types/date-time/now.ts
---

Probed with a scratch script of `new Intl.DateTimeFormat("en-US", { timeZone })` on Node v22.22.0 (the repo targets Node 24+ and Chromium; neither was run, so every line below is `unchecked` for them).

- Invalid id throws `RangeError: Invalid time zone specified: <id>`; the empty string too. `Z` throws.
- Validation is not a closed IANA check: `+05:30` and `+0530` are accepted (resolved to `+05:30`), `EST` resolves to `America/Panama`, `EST5EDT` to `America/New_York`. A ZoneId that means "named IANA zone" must reject offset-style and legacy aliases itself (regexp on the id) if it wants to.
- Matching is case-insensitive and `resolvedOptions().timeZone` returns the canonical spelling, and canonicalisation is ICU-version specific: `Asia/Calcutta` stays Calcutta, `Europe/Kyiv` -> `Europe/Kiev`, `America/Nuuk` -> `America/Godthab`, `UTC`/`Etc/UTC`/`GMT` all -> `UTC`. So `ZoneId.id` equality across engines is not stable; round-trip tests should not pin canonical spelling of renamed zones.
- `Intl.supportedValuesOf("timeZone")` exists but is not a validity oracle: 418 entries, does not include `UTC`.
- `timeZoneName: "longOffset"` yields `GMT` for zero (no `+00:00`) and `GMT+05:30` otherwise; historical local mean time offsets carry seconds (`GMT+00:17:30` Amsterdam 1800, `GMT-04:56:02` New York 1800). An offset parser must accept `GMT`, `GMT+HH:MM` and `GMT+HH:MM:SS`; offsets are not always whole minutes.
- `now.ts`'s formatter (era short, h23, gregory, latn) formats -62135596800000 (0001-01-01T00:00Z) in New_York as `12/31/1 BC, 19:03:58` - a zone's pre-1883 LMT pushes year-1 instants into 1 BC, and 9999-12-31T23:59:59Z in New_York reads `12/31/9999 AD, 18:59:59`. A zoned value whose civil field is within 1-9999 can have an instant outside it and vice versa; the 1-9999 LocalDate range check fires on the civil side.
- `Date.UTC(y, ...)` and `new Date(y, ...)` map years 0-99 to 1900-1999 (`Date.UTC(1,0,1)` formatted as 1900/1901). Instants for early civil dates must come from `civil.ts` day arithmetic (days-from-civil) not `Date.UTC`.
- Formatting a non-finite or beyond +-8.64e15 value throws RangeError (same bound as `now.ts` MAX_EPOCH_MILLISECONDS).
