# @vipengele/ts

The batteries-included umbrella package of the vipengele TypeScript framework. It re-exports the
public surface of the `@vipengele/ts-core-*` packages from one entry point, so an application
depends on a single package.

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
