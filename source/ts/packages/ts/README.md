# @vipengele/ts

The batteries-included umbrella package of the vipengele TypeScript framework. It re-exports the
public surface of the `@vipengele/ts-core-*` packages from one entry point, so an application
depends on a single package. It re-exports:

- `Numeric`, `Locale` (with `HourCycle`, `IsoWeekday`, `NameStyle`) and the date-time values
  `LocalDate`, `LocalTime`, `LocalDateTime` (with `DateTimeParseError`, `InvalidDateTimeError`,
  `isDateTimeParseError`, `isInvalidDateTimeError` and the `DateSegment`, `DateSegmentType`,
  `DateTimeTryParseResult` and `IsoDayOfWeek` types);
- `Scope`, `normalizeAttributes` (with its types) and `VipengeleError`;
- from redaction, `redact`, `secretKeys`, `composePolicies`, `redactUrl`, `redactQueryString` and
  `redactHeaders` (with `RedactionPolicy`, `KeyMatcher`, `RedactOptions`, `RedactStringOptions`,
  `Replacement`).

Runtime detection, the logger and the error reporter are not re-exported; import them from
`@vipengele/ts-core-common/runtime` and `@vipengele/ts-core-observability`.

```sh
pnpm add @vipengele/ts
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## Numeric

Locale-aware `parse`, `tryParse` and `format` for numbers. Each takes a `Locale` and falls back to
`Locale.default()` when it is omitted.

```ts
import { Locale, Numeric } from "@vipengele/ts";

const de = new Locale("de-DE");

Numeric.format(1234.5, de); // "1.234,5"
Numeric.parse("1.234,5", de); // 1234.5
Numeric.tryParse("abc", de); // { success: false }
```

## Locale

A BCP 47 language tag and the calendar and clock conventions it carries. `Locale.default()` is the
runtime's own locale. Month names run January..December and weekday names Monday..Sunday, whatever
the locale's own first day of the week; `firstDayOfWeek` is ISO-numbered, 1 (Monday) through 7
(Sunday).

```ts
import { Locale } from "@vipengele/ts";

const locale = new Locale("en-us");

locale.tag; // "en-US"
locale.uses24Hour; // false
locale.hourCycle; // "h12"
locale.firstDayOfWeek; // 7
locale.monthNames("long")[0]; // "January"
locale.weekdayNames("short")[0]; // "Mon"
Locale.default(); // the runtime's locale
```

## Dates and times

`LocalDate`, `LocalTime` and `LocalDateTime` are validated, immutable, zoneless civil values with
ISO 8601 `parse`, `tryParse` and `toString`, `LocalDate` and `LocalDateTime` arithmetic, and
`now()`. `format`, `parseLocalized` and `tryParseLocalized` take a `Locale` and fall back to
`Locale.default()`; `LocalDate#segments` returns the locale's date pattern as `year`, `month`, `day`
and `literal` segments.

```ts
import { LocalDate, LocalTime, Locale } from "@vipengele/ts";

const de = new Locale("de-DE");
const date = LocalDate.of(2024, 3, 9);

date.toString(); // "2024-03-09"
date.format(de); // "09.03.2024"
date.plusDays(30).toString(); // "2024-04-08"
LocalDate.parseLocalized("09.03.2024", de).equals(date); // true
LocalDate.tryParse("2024-02-30"); // { success: false }
date.segments(new Locale("en-US")).map((s) => s.type); // ["month", "literal", "day", "literal", "year"]

LocalTime.of(15, 30).format(new Locale("en-US")); // "03:30 PM"
```

Invalid fields throw an `InvalidDateTimeError` and unparseable text a `DateTimeParseError`; check
them with `isInvalidDateTimeError` and `isDateTimeParseError`.
