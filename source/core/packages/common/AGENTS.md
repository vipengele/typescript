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
  `useCarrier`. Its root holds the four reserved Resource keys (`service.name`,
  `service.version`, `deployment.environment.name`, `process.runtime.name`).
- `Scope.resource()` returns the `Resource` (exported type) read from the realm's one root,
  whatever scope is current. The logger passes it to every Sink per record; it is a function, not a
  captured value, because an application may supply the Resource after a Logger was created.
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
