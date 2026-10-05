# @vipengele/ts-core-common

Shared types and primitives the other framework packages agree on, shipped as tree-shakeable
sub-paths (`./types/numeric`, `./types/date-time`, `./locale`, `./context`, `./scope`, `./runtime`, …).
A sub-path is a slice of this one package, not a separate package.

## Commands (run from `source/core`)

```bash
pnpm build          # turbo run build
pnpm type-check
pnpm test           # vitest under Node and Chromium, 100% v8 coverage
pnpm lint
pnpm format:check
```

## Adding a sub-path

A sub-path needs both a `tsup.config.ts` `entry` and a `package.json` `exports` key;
`src/package-exports.test.ts` fails when either is missing.

## Scope (`src/scope`, `./scope`)

- `Scope` is the ambient context tree: `current`, `propagate`, `inherit`, `isolated`, `resource`,
  `setResource`, `setUser`, `setTag`, `setContext`, `useCarrier`. Its root holds the four reserved
  Resource keys (`service.name`, `service.version`, `deployment.environment.name`,
  `process.runtime.name`) and never changes except through `setResource`.
- `Scope.resource()` returns the `Resource` (exported type) read from the realm's one root,
  whatever scope is current, as a frozen per-call snapshot. The logger passes it to every Sink per
  record and the reporter to every Transport per event; it is a function, not a captured value,
  because `Scope.setResource(partial)` can change the root after a Logger or Reporter exists.
- `setResource` (`root.ts`) swaps the root's frozen attribute bag for a new frozen one on the same
  node, so every scope and every package copy reads the merged values via the `Symbol.for` slots. A
  key that is `undefined` or not a string is skipped, an unknown key ignored, and it never throws.
- `setUser`/`setTag`/`setContext` write flat dotted keys (`user.id`/`user.email`/`user.username`;
  the plain key; `name.field`, one level deep) to the current scope. `writeAll` validates every key
  (`assertSettable`) before writing any, so a Resource key throws `ReservedScopeKeyError` with
  nothing half-written; `setContext`'s `name` must be a non-empty string (`TypeError`).
- `snapshot(scope)` (framework-internal, exported from `./scope`) flattens a scope and its non-root
  ancestors into one prototype-less record, innermost wins, never the Resource. Only the reporter's
  enrich stage uses it; `Scope` itself exposes no ancestry (ADR-0006).
- `@isolatedScope`/`@scoped` support both decorator dialects (`agentic/rules/method-decorator-supports-both-dialects.md` at the repo root).

## `./types/date-time`

- `LocalDate`, `LocalTime` and `LocalDateTime` are immutable and zoneless: a civil date and/or
  wall-clock time with no offset or time zone. Each has `of`, `parse`, `tryParse`, `compare`,
  `now(clock?)` and ISO 8601 formatting.
- `LocalTime` and `LocalDateTime` hold a `nanosecond` (0 to 999,999,999); `now()` floors to the
  microsecond. ISO output has `:ss` when the second or nanosecond is non-zero and a fraction only
  when the nanosecond is, as 3, 6 or 9 digits; input takes one to nine fraction digits,
  right-padded. `fraction.ts` is the one place the fraction is printed and parsed.
- Construction validates and never rolls an overflowing field into the next unit; February 30 throws
  `InvalidDateTimeError`. A string that is not ISO 8601, or names no real date or time, throws
  `DateTimeParseError`.
- Both errors extend `VipengeleError` and are checked with `isInvalidDateTimeError` /
  `isDateTimeParseError`, never `instanceof`.
- Each has a locale-aware `format(locale)` and a `parseLocalized`/`tryParseLocalized(str, locale)`
  pair taking a `./locale` `Locale`; `LocalDate#segments(locale)` returns the formatted date as
  typed `DateSegment`s (`year`, `month`, `day`, `literal`).
- `src/types/date-time/locale-format.ts` derives each locale's numeric date and time patterns from
  `Intl.DateTimeFormat` and caches them per `locale.tag`. Localized time is hour and minute only,
  and a 12-hour pattern parses its day period. Parsing strips bidi marks; formatting keeps them.
  The year is exactly four digits; month and day accept one or two.
- `src/types/date-time/civil.ts` holds the shared civil-calendar arithmetic; `now.ts` reads the
  wall clock in the current time zone through `Intl.DateTimeFormat` and the `Clock` from `src/time/clock`.
- `src/types/date-time/civil-fields.ts` is the one place an epoch time is turned into civil fields in
  a named zone: it owns the per-zone `Intl.DateTimeFormat` cache, the BC-era year fix-up and the
  microsecond-floored fraction. `now.ts`'s `civilNow` and `ZoneId#offsetSecondsAt` both call it.
- `Instant` is a point on the UTC timeline, held as epoch seconds and a nanosecond of that second,
  within `Date`'s ±8.64e15 ms. Its arithmetic is exact integer arithmetic and never reads a `Date`;
  `parse` takes ISO 8601 with a literal `Z` only, and a year outside 0000-9999 is a sign and six
  digits. An out-of-range value is a `RangeError`.
- `ZoneId` is a named IANA zone whose `id` is `Intl`'s canonical spelling, so equality is by `id`
  and the spelling depends on the runtime's ICU version. `ZoneId.of` throws `UnknownZoneError` for
  an unknown name or a UTC-offset id (`+05:30`, `Z`); it is checked with `isUnknownZoneError`, never
  `instanceof`. `offsetSecondsAt(instant)` returns whole seconds, local-mean-time seconds included.
- `ZonedDateTime` is a date and time of day in a `ZoneId` with the offset it reads in there (`of`,
  `parse`, `tryParse`, `toLocalDateTime`, `toInstant`, `compare`, `equals`, `toString`). It is built by
  `ZonedDateTime.of`, `LocalDateTime#atZone`, `LocalDate#atStartOfDay` and `Instant#atZone`.
  `ZonedDateTimeOptions { disambiguation? }` and the `Disambiguation` type are exported; a gap or an
  overlap is settled by `compatible` (default, `java.time`'s), `earlier`, `later` or `reject`, and
  `reject` throws `ZoneResolutionError`, checked with `isZoneResolutionError`, never `instanceof`.
  Every place a local value is resolved in a zone takes the same option.
- `src/types/date-time/zone-resolve.ts` is internal and not exported from `index.ts`: `resolveLocal`
  classifies a local date-time in a zone as unique, gap or overlap by testing the zone's offsets a day
  before and after it, and `disambiguate` applies the mode.
- `plusDays`/`minusDays`/`plusMonths`/`minusMonths` move the local date and re-resolve it with the
  options; `plusHours`..`plusNanos` and their `minus` forms move the instant exactly, so a day across a
  spring-forward is 23 hours.
- `parse` is strict ISO: `<local date-time>±HH:mm[<zone>]`, the offset required and one the zone reads
  that time in (it picks the reading in an overlap), never `Z`.
- Import cycle: `LocalDateTime`, `LocalDate` and `Instant` import `ZonedDateTime`, which imports them
  back. `ZonedDateTime` and `zone-resolve.ts` touch those classes only when a method runs, never while
  the module evaluates, so whichever module loads first sees every binding initialised.
  `import-order.test.ts` loads each entry first in a fresh module graph to pin this; a top-level use
  of an imported class breaks it. Biome has no import-cycle rule to catch it (ADR-0015).
