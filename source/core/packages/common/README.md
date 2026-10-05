# @vipengele/ts-core-common

Shared types and primitives of the vipengele TypeScript core: context propagation, error
normalization, runtime detection, locales, locale-aware numbers and civil dates and times. It exists so the other
`@vipengele/ts-core-*` packages agree on one definition of each; applications rarely import it directly.

```sh
pnpm add @vipengele/ts-core-common
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## `./context`

`createAsyncContextStore` gives a value a home in the call graph, keyed by a string shared across
every copy of the package in the realm. The store's shape is identical on every runtime; only the
carrier backing it changes, in a fixed fallback order: `AsyncLocalStorage` on Node, then a native
`AsyncContext.Variable`, then a synchronous stack every runtime supports.

```ts
import { createAsyncContextStore } from "@vipengele/ts-core-common/context";

const store = createAsyncContextStore("example", { requestId: "default" });

store.propagate({ requestId: "abc" }, async () => {
  console.log(store.current()); // { requestId: "abc" }
  await somethingAsync();
  console.log(store.current()); // Node: still { requestId: "abc" }. Browser: back to the default.
});
```

The two carriers that follow the runtime's own scheduler (`AsyncLocalStorage`, `AsyncContext`)
keep the value installed across an `await`; the synchronous stack fallback does not, because
nothing about a plain function call tells it when the microtask queue resumed. Both call sites the
sections below cover exist to work around that divergence.

**A disconnected callback** — an event listener, a `setTimeout`, a callback handed to someone
else's `.then` — is a call site you don't control, so you can't wrap it in the 2-argument form of
`propagate`. Its 1-argument form captures the value current right now and returns a function that
reinstalls it whenever the callback eventually runs:

```ts
button.addEventListener("click", store.propagate(() => handleClick()));
```

**Capture-and-rerun** answers the same gap from the other side: a call site you *do* control, in
the browser, where a plain `await` inside one `propagate` call would lose the value. Read
`store.current()` before the gap, and hand it to a fresh `propagate` call after it:

```ts
const captured = store.current();
await somethingAsync();
store.propagate(captured, () => afterTheGap());
```

## `./scope`

`Scope` is the ambient context tree a log record or an error event reads its attributes from: a
node holds attributes of its own, and `get` walks up to the nearest ancestor holding a key when
the node itself doesn't. The realm has one tree — a root built once from a `Resource` (`service.name`,
`service.version`, `deployment.environment.name`, `process.runtime.name`), and a default scope
beneath it that's current until something propagates a different one.

```ts
import { Scope } from "@vipengele/ts-core-common/scope";

Scope.current().get("requestId"); // undefined outside any propagation

Scope.isolated("http-request", { requestId: "abc" }, () => {
  Scope.current().get("requestId"); // "abc"

  Scope.inherit("db-query", { table: "users" }, () => {
    Scope.current().get("requestId"); // "abc" — inherited from the parent
    Scope.current().get("table"); // "users"
  });
});
```

- `Scope.current()` — the scope installed by the innermost enclosing propagation, or the realm's
  default scope outside any.
- `Scope.propagate(scope, fn)` — calls `fn` with `scope` current, restoring the enclosing scope once
  `fn` returns or throws. `Scope.propagate(fn)`, its 1-argument form, captures the scope current now
  and returns a function that reinstalls it whenever a disconnected callback eventually runs.
- `Scope.inherit(tag, attributes, fn)` — a child of the current scope carrying `tag` and
  `attributes`, current for `fn`.
- `Scope.isolated(tag, attributes, fn)` — a child of the root, not of whatever scope is current: the
  start of a Unit of Work that reads nothing any other Unit of Work's scopes hold, only the root's
  Resource.
- `Scope.resource()` — a frozen snapshot of the root's Resource, read per call.
- `Scope.setResource(partial)` — merges the four Resource keys into the realm's one root, in place,
  from whichever copy of the package calls it; Loggers and Reporters already built read the merged
  values. A key that is `undefined` or not a string is skipped, never cleared or coerced; an
  unknown key is ignored; it never throws.
- `Scope.setUser({ id, email, username })` — sets `user.id`, `user.email` and `user.username` on the
  current scope, from the fields that are not `undefined`.
- `Scope.setTag(key, value)` — sets the plain `key` on the current scope.
- `Scope.setContext(name, data)` — sets one `name.field` key per own field of `data` on the current
  scope, one level deep; `name` must be a non-empty string, else a `TypeError`.
- `Scope.useCarrier(carrier)` — replaces the carrier the current scope rides on, seen by every copy
  of the package in the realm from then on.
- `snapshot(scope)` — the attributes `scope` and its non-root ancestors hold, flattened into one
  null-prototype record, innermost winning and never the Resource keys. Framework-internal, not for
  application use.

`setUser`, `setTag` and `setContext` write flat dotted keys to the current scope, and validate every
key before writing any: a Resource key throws `ReservedScopeKeyError` and leaves nothing written.

```ts
Scope.setResource({ "service.name": "checkout", "deployment.environment.name": "production" });

Scope.setUser({ id: "u-42", email: "ada@example.com" }); // user.id, user.email
Scope.setTag("region", "eu-west"); // region
Scope.setContext("cart", { id: "c-9", items: 3 }); // cart.id, cart.items
```

`isolatedScope(tag)` and `scoped(tag, attributes)` are method decorators wrapping a method's whole
call in `Scope.isolated`/`Scope.inherit` respectively, usable under either the standard decorator
dialect or `experimentalDecorators`.

The root's four Resource keys, and the root scope itself, are reserved: `Scope.current().set(...)`
throws a `ReservedScopeKeyError` when the target is the root, or the key is one the root holds.
Check for it with `isReservedScopeKeyError`, never `instanceof ReservedScopeKeyError`:

```ts
import { isReservedScopeKeyError, Scope } from "@vipengele/ts-core-common/scope";

try {
  Scope.current().set("service.name", "checkout");
} catch (e) {
  if (isReservedScopeKeyError(e)) {
    // "service.name" is a Resource key — every scope refuses to set it.
  }
}
```

## `./locale`

`Locale` is a BCP 47 language tag and the calendar and clock conventions it carries. It is the
locale argument every locale-aware type in the package takes.

```ts
import { Locale } from "@vipengele/ts-core-common/locale";

const de = new Locale("de-DE");
de.tag; // "de-DE"
de.uses24Hour; // true
de.firstDayOfWeek; // 1 (Monday)
de.monthNames("long"); // ["Januar", "Februar", "März", …, "Dezember"]
de.weekdayNames("short"); // ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

Locale.default(); // the runtime's own locale, read on every call
```

- `new Locale(tag)` canonicalizes `tag` and throws a `RangeError` when it is not a well-formed
  BCP 47 language tag, `""` included.
- `Locale.default()` — the runtime's own locale.
- `tag` — the canonicalized tag.
- `hourCycle` (`"h11" | "h12" | "h23" | "h24"`) and `uses24Hour` — the clock the locale counts
  hours on.
- `monthNames(style)` and `weekdayNames(style)` — `style` is `"long"`, `"short"` or `"narrow"`.
  Months run January..December and weekdays Monday..Sunday (ISO order), whatever the locale's own
  first day of the week.
- `firstDayOfWeek` — the locale's first day of the week, ISO-numbered (`1` Monday..`7` Sunday);
  Monday when the engine exposes no week info.

`HourCycle`, `IsoWeekday` and `NameStyle` are exported alongside it.

## `./types/numeric`

`Numeric` formats and parses numbers for a `Locale`. Omitting the locale means
`Locale.default()`.

```ts
import { Locale } from "@vipengele/ts-core-common/locale";
import { Numeric } from "@vipengele/ts-core-common/types/numeric";

const de = new Locale("de-DE");

Numeric.format(1234.5, de); // "1.234,5"
Numeric.parse("1.234,5", de); // 1234.5
Numeric.tryParse("abc", de); // { success: false }
Numeric.tryParse("1.234,5", de); // { success: true, value: 1234.5 }
```

- `Numeric.format(value, locale?, options?)` — digits are always ASCII 0-9; the locale's
  separators are kept. `maximumFractionDigits` defaults to 20.
- `Numeric.parse(str, locale?)` — accepts the locale's own separators and their ASCII
  equivalents, and throws a `NumericParseError` (check it with `isNumericParseError`) when `str`
  does not spell a number.
- `Numeric.tryParse(str, locale?)` — the non-throwing form, returning `{ success, value }`.

Each takes a `Locale`, not a string: a malformed tag is rejected by `new Locale(tag)`, once, with a
`RangeError`, not by every call.

## `./types/date-time`

`LocalDate`, `LocalTime` and `LocalDateTime` are validated, immutable, zoneless civil values: a
calendar date, a wall-clock time, or both, with no time zone or offset. A value that exists is a
valid one — `of` throws an `InvalidDateTimeError` for fields that name no date or time.

```ts
import { LocalDate, LocalDateTime, LocalTime } from "@vipengele/ts-core-common/types/date-time";

const date = LocalDate.of(2024, 3, 9);
date.toString(); // "2024-03-09"
date.dayOfWeek; // 6 (Saturday, ISO-numbered)
date.plusMonths(1).toString(); // "2024-04-09"
LocalDate.of(2024, 1, 31).plusMonths(1).toString(); // "2024-02-29", clamped to the month's end

LocalTime.of(15, 30).toString(); // "15:30"
LocalDateTime.ofFields(2024, 3, 9, 15, 30).toString(); // "2024-03-09T15:30"
LocalDate.now().toString(); // today's date on the clock's local calendar
```

- `of(...)` (`LocalDateTime.ofFields(...)` for the flat form, `LocalDateTime.of(date, time)` to
  combine two values) — validates its fields; `LocalDate` runs from 0001-01-01 to 9999-12-31.
- `LocalTime` and `LocalDateTime` hold a `nanosecond` from 0 to 999,999,999, the last argument of
  `LocalTime.of(hour, minute, second = 0, nanosecond = 0)` and `LocalDateTime.ofFields(...)`.
- `parse(str)` reads ISO 8601, a time as `HH:mm`, `HH:mm:ss` or `HH:mm:ss.f` with one to nine
  fraction digits (right-padded, never rounded), and throws a `DateTimeParseError`; `tryParse(str)` returns
  `{ success: true, value }` or `{ success: false }`. `toString()` writes ISO 8601, with a fraction only when the nanosecond is non-zero, as the
  shortest exact 3, 6 or 9 digits (`.123`, `.123456`, `.123456789`). Check the errors
  with `isInvalidDateTimeError` and `isDateTimeParseError`, never `instanceof`.
- `plusDays`, `minusDays`, `plusMonths` and `minusMonths` on `LocalDate` and `LocalDateTime`;
  `dayOfWeek` and `lengthOfMonth` on `LocalDate`; `compare` and `equals` on all three.
- `now(clock?)` — the current civil value, read from a `Clock` (`systemClock` by default). A
  `Clock` is epoch milliseconds, so a fixed one makes a test deterministic. `now()` floors to the
  microsecond: a double resolves about 0.24 µs at current epochs and browsers coarsen further, so
  the nanosecond's last three digits are zero.

**Localized text** — `format(locale?)`, `parseLocalized(str, locale?)` and
`tryParseLocalized(str, locale?)` write and read a locale's own numeric pattern. Omitting the locale
means `Locale.default()`.

```ts
import { Locale } from "@vipengele/ts-core-common/locale";

const de = new Locale("de-DE");
const us = new Locale("en-US");

date.format(de); // "09.03.2024"
date.format(us); // "03/09/2024"
LocalDate.parseLocalized("09.03.2024", de).toString(); // "2024-03-09"
LocalDate.tryParseLocalized("not a date", de); // { success: false }

const time = LocalTime.of(15, 30);
time.format(de); // "15:30"
time.format(us); // "03:30 PM"
LocalTime.parseLocalized("3:30 PM", us).toString(); // "15:30"

LocalDateTime.ofFields(2024, 3, 9, 15, 30).format(us); // "03/09/2024, 03:30 PM"
```

A time or date-time is localized to hour and minute only, so parsing one gives second and
nanosecond `0`. The locale's hour cycle is honoured: a 12-hour locale prints a day-period marker
and a 24-hour one never prints hour 24. The pattern is derived from `Intl`, with the Gregorian
calendar and ASCII digits forced.

**Segments** — `LocalDate#segments(locale?)` returns the date pattern as `DateSegment[]`, each a
`{ type: "year" | "month" | "day" | "literal", value }`, for a date input that lays out its own
fields in the locale's order.

```ts
date.segments(us);
// => [{ type: "month", value: "03" }, { type: "literal", value: "/" },
//     { type: "day", value: "09" }, { type: "literal", value: "/" },
//     { type: "year", value: "2024" }]
```

`DateSegment`, `DateSegmentType`, `DateTimeTryParseResult` and `IsoDayOfWeek` are exported
alongside the values.

### `ZoneId`

A named IANA time zone as the runtime's `Intl` knows it. Instances are frozen.

```ts
import { Instant, ZoneId } from "@vipengele/ts-core-common/types/date-time";

const berlin = ZoneId.of("Europe/Berlin");

berlin.id; // "Europe/Berlin"
berlin.offsetSecondsAt(Instant.parse("2024-07-01T00:00:00Z")); // 7200
ZoneId.of("europe/berlin").equals(berlin); // true
ZoneId.of("+05:30"); // throws an UnknownZoneError
```

- `ZoneId.of(id)` matches case-insensitively and accepts any name `Intl` does, legacy aliases such
  as `UTC`, `GMT` and `EST` included. It throws an `UnknownZoneError` (check it with
  `isUnknownZoneError`) for an empty string, an unknown name, or a UTC-offset id such as `+05:30` or
  `Z`: an offset is not a zone.
- `id` is `Intl`'s canonical spelling, so `america/new_york` and `America/New_York` are equal zones.
  The canonical spelling is the runtime's own and depends on its ICU version: `EST` resolves to
  `America/Panama` on Node 22, and `Etc/UTC` may read as `UTC` or `Etc/UTC`.
- `ZoneId.systemDefault()` reads the runtime's zone on every call.
- `offsetSecondsAt(instant)` is the offset from UTC at that instant in whole seconds, positive east
  of Greenwich. An instant before the zone's first transition reads in local mean time, which
  carries seconds: Berlin in 1880 is `3208` (+00:53:28).
- `equals(other)` compares canonical ids; `toString()` is the `id`.

### `Instant`

A point on the UTC timeline to the nanosecond, held as epoch seconds and a nanosecond of that
second. The range is `Date`'s, ±8.64e15 milliseconds of the epoch (`-271821-04-20T00:00:00Z` to
`+275760-09-13T00:00:00Z`); a value or result outside it is a `RangeError`. Every operation is exact
integer arithmetic and returns a new frozen instance.

```ts
const instant = Instant.ofEpochMilli(1_700_000_000_123);

instant.toString(); // "2023-11-14T22:13:20.123Z"
instant.toEpochSecond(); // 1700000000
instant.nanosecond; // 123000000
instant.plusSeconds(60).toString(); // "2023-11-14T22:14:20.123Z"
instant.minusNanos(1).toString(); // "2023-11-14T22:13:20.122999999Z"
Instant.ofEpochSecond(-1, 999_999_999).toString(); // "1969-12-31T23:59:59.999999999Z"
Instant.parse("2026-10-01T12:30:00Z").equals(instant); // false
Instant.tryParse("2026-10-01T12:30:00+02:00"); // { success: false }, only a literal Z is read
```

- `ofEpochSecond(second, nano = 0)`, `ofEpochMilli(milli)` and `now(clock?)` construct one. The nano
  is the nanosecond of its second, never carried into it, so an instant before the epoch has a
  negative second and a positive nano. `now()` floors to the microsecond.
- `toEpochSecond()`, `nanosecond` and `toEpochMilli()` read it back, flooring.
- `plusSeconds`, `plusMillis` and `plusNanos`, and their `minus` counterparts, take a safe integer.
- `parse(str)` reads ISO 8601 in UTC, `YYYY-MM-DDTHH:mm:ss` with an optional one-to-nine digit
  fraction and a literal `Z`, and throws a `DateTimeParseError`; `tryParse(str)` returns a
  `DateTimeTryParseResult`. A year outside 0000 to 9999 is written and read as a sign and six
  digits (`+275760-09-13T00:00:00Z`). `toString()` writes the same, with a fraction only when the
  nanosecond is non-zero, as 3, 6 or 9 digits.
- `Instant.compare(a, b)` returns `-1`, `0` or `1`; `equals` compares instants.

### `ZonedDateTime`

A date and time of day in a named time zone, with the offset from UTC it reads in there: one
instant on the timeline, as the zone's wall clock shows it. The offset is in whole seconds and
carries seconds where the zone's rules do. Instances are frozen.

```ts
import { Instant, LocalDateTime, ZonedDateTime, ZoneId } from "@vipengele/ts-core-common/types/date-time";

const berlin = ZoneId.of("Europe/Berlin");
const meeting = LocalDateTime.parse("2026-10-01T14:30").atZone(berlin);

meeting.toString(); // "2026-10-01T14:30+02:00[Europe/Berlin]"
meeting.offsetSeconds; // 7200
meeting.toInstant().toString(); // "2026-10-01T12:30:00Z"
meeting.toLocalDateTime().toString(); // "2026-10-01T14:30"
ZonedDateTime.parse("2026-10-01T14:30+02:00[Europe/Berlin]").equals(meeting); // true
```

- `ZonedDateTime.of(localDateTime, zone, options?)` builds one. A time the zone reads once takes
  that reading's offset; a time it skips or reads twice is settled by `options.disambiguation`.
- `zone`, `offsetSeconds`, `toLocalDateTime()` and `toInstant()` read it back; `compare(a, b)`
  orders by instant to the nanosecond whatever the zones, and `equals` is the same instant in the
  same zone.
- `toString()` writes `<local date-time><offset>[<zone id>]`, the offset as `±HH:mm` (`±HH:mm:ss`
  when its seconds are non-zero), and a zero offset as `+00:00`, never `Z`.

**Gaps and overlaps** — a zone's wall clock skips a span when its offset moves forward (a gap) and
reads one twice when it moves back (an overlap). `disambiguation` is one of four modes, `compatible`
by default, which is what `java.time` does. A time the zone reads exactly once resolves the same
under every mode.

| Mode         | Gap (a skipped time)                       | Overlap (a time read twice)  |
| ------------ | ------------------------------------------ | ---------------------------- |
| `compatible` | moves forward by the gap's length          | the earlier instant          |
| `earlier`    | moves back by the gap's length             | the earlier instant          |
| `later`      | moves forward by the gap's length          | the later instant            |
| `reject`     | throws a `ZoneResolutionError`             | throws a `ZoneResolutionError` |

```ts
// Berlin skips 02:00-03:00 on 2026-03-29 and reads 02:00-03:00 twice on 2026-10-25.
const skipped = LocalDateTime.parse("2026-03-29T02:30");
const twice = LocalDateTime.parse("2026-10-25T02:30");

skipped.atZone(berlin).toString(); // "2026-03-29T03:30+02:00[Europe/Berlin]"
skipped.atZone(berlin, { disambiguation: "earlier" }).toString(); // "2026-03-29T01:30+01:00[Europe/Berlin]"
twice.atZone(berlin).toString(); // "2026-10-25T02:30+02:00[Europe/Berlin]"
twice.atZone(berlin, { disambiguation: "later" }).toString(); // "2026-10-25T02:30+01:00[Europe/Berlin]"
skipped.atZone(berlin, { disambiguation: "reject" }); // throws a ZoneResolutionError
```

The value always holds the wall-clock time its instant reads as in the zone, so one built from a
skipped time holds the shifted time. A `ZoneResolutionError` is checked with `isZoneResolutionError`,
never `instanceof`.

**Arithmetic** — days and months move the calendar, hours down to nanoseconds move the instant.

- `plusDays`, `minusDays`, `plusMonths` and `minusMonths` move the local date at the same
  wall-clock time and re-read the result in the zone, under the same `options` argument as `of`.
  A day across a transition is not 24 hours: a spring-forward day is 23 and a fall-back day is 25.
  Months clamp the day as `LocalDateTime` does.
- `plusHours`, `plusMinutes`, `plusSeconds`, `plusNanos` and their `minus` counterparts move the
  instant by exactly that much elapsed time, so the wall clock jumps by the transition's length
  across one. They take no options: an instant names one reading.

```ts
const saturday = LocalDateTime.parse("2026-03-28T12:00").atZone(berlin);

saturday.plusDays(1).toString(); // "2026-03-29T12:00+02:00[Europe/Berlin]", 23 hours later
saturday.plusHours(24).toString(); // "2026-03-29T13:00+02:00[Europe/Berlin]"
```

**ISO form** — `parse(str)` and `tryParse(str)` read exactly the form `toString` writes, with the
offset and the bracketed zone name both required: no `Z`, no surrounding space, nothing after the
bracket. The offset must be one the zone reads that local date-time in, so it never moves the value;
in an overlap it picks which reading is meant, which makes `toString` and `parse` a lossless round
trip for either one. A time in a gap has no offset that agrees. A string that fails any of this
throws a `DateTimeParseError` (`tryParse` returns `{ success: false }`).

```ts
ZonedDateTime.parse("2026-10-25T02:30+01:00[Europe/Berlin]").toInstant().toString(); // "2026-10-25T01:30:00Z"
ZonedDateTime.tryParse("2026-10-01T14:30+05:00[Europe/Berlin]"); // { success: false }, Berlin is +02:00 then
```

**Conversions** — each takes the same `options` and builds the value as `of` does.

- `LocalDateTime#atZone(zone, options?)` is `ZonedDateTime.of(this, zone, options)`.
- `LocalDate#atStartOfDay(zone, options?)` is the first instant of the date in the zone. A midnight
  the zone skips moves forward to the time the gap ends; when the gap spans the whole date, as
  Samoa's 2011-12-30 in `Pacific/Apia` does, that is midnight of the next date the zone reads. The
  disambiguation passes straight through, so `earlier` moves a skipped midnight back by the gap's
  length, into the previous date.
- `Instant#atZone(zone)` is the wall-clock reading of the instant, with the offset the zone has
  then. An instant names one reading, so there is nothing to disambiguate.

```ts
LocalDate.of(2011, 12, 30).atStartOfDay(ZoneId.of("Pacific/Apia")).toString(); // "2011-12-31T00:00+14:00[Pacific/Apia]"
Instant.parse("2026-10-25T01:30:00Z").atZone(berlin).toString(); // "2026-10-25T02:30+01:00[Europe/Berlin]"
```

`ZonedDateTimeOptions` and `Disambiguation` are exported alongside the values.

## `./runtime`

`detectRuntime` names the runtime family code is executing in, and `detectCapability` says whether
that runtime offers one behaviour that differs between runtimes.

```ts
import { detectCapability, detectRuntime } from "@vipengele/ts-core-common/runtime";

detectRuntime(); // "browser" | "worker" | "node" | "deno" | "bun" | "edge" | "unknown"
detectCapability("ansiColour"); // true when standard output renders ANSI colour escapes
```

**Runtimes** — checked most specific first, the first match wins: `deno`, `bun`, `edge`
(Cloudflare Workers, or a global `EdgeRuntime`), `node` (`process.versions.node`), `worker`
(`WorkerGlobalScope`), `browser` (`window` and `document`), else `unknown`. Deno, Bun and edge
runtimes can define a Node-compatible `process`, and jsdom defines `window` inside Node, so each is
ruled out before the check it could be mistaken for.

**Capabilities** — each is detected on its own:

- `consoleStyling` — the console renders `%c` CSS directives: browsers, web workers and Deno.
- `ansiColour` — standard output renders ANSI colour escapes. A non-empty `NO_COLOR` forces it off
  and wins over everything; `FORCE_COLOR` forces it on unless it is `"0"` or `"false"`; otherwise it
  follows whether stdout is a TTY and `TERM` is not `dumb`.
- `asyncContext` — the engine offers `AsyncLocalStorage` or `AsyncContext.Variable`. It says a
  carrier can be built, not that a store is propagating a value.
- `sendBeacon` — `navigator.sendBeacon` can queue a request that outlives the page.
- `processExitHooks` — `process.on` can register a handler that runs as the process exits.

**Memoisation** — without a `source`, each answer is read from `globalThis` lazily, the first time
it is asked for, and memoised (the runtime once, each capability on its own) for the life of the
module. An injected `RuntimeSource` — a plain object standing in for `globalThis` — is read afresh
on every call and bypasses the memo, which is how a test forces the answer of a runtime the suite
does not run in:

```ts
detectRuntime({ Deno: {} }); // "deno"
detectCapability("sendBeacon", { navigator: { sendBeacon() {} } }); // true
```

The umbrella `@vipengele/ts` does not re-export `./runtime`; import it from this package.

## Attributes

`normalizeAttributes` converts arbitrary caller data — a `Date`, a `Map`, an `Error`, an object
with a throwing getter — into an `Attributes` record every sink and transport can serialise as
JSON.

```ts
import { normalizeAttributes } from "@vipengele/ts-core-common/attributes";

normalizeAttributes({ userId: 42, seenAt: new Date() });
// => { userId: 42, seenAt: "2024-01-01T00:00:00.000Z" }
```

The result is bounded (depth, breadth and string length all default to a fixed limit and are
configurable), cycle-safe (an object that contains itself becomes `"[Circular]"` where it
recurs), and never throws — a property that fails to read becomes `"[Unreadable]"` instead of
aborting the whole call.

It is a record-rooted wrapper over the same engine as [`toJsonSafe`](#serialization), which
accepts any value as its root. Its root record is walked as a record — the root's own `toJSON` and
type handling are not applied — and every nested value is converted exactly as `toJsonSafe`
converts it.

## `./serialization`

`toJsonSafe(value, options?)` turns any value — a primitive, a `Date`, a `Map`, an `Error`, a
typed array, an object that contains itself — into a JSON-safe one, bounded in size, and never
throws.

```ts
import { toJsonSafe } from "@vipengele/ts-core-common/serialization";

const order = { id: 9007199254740993n, placedAt: new Date(0), tags: new Set(["a"]), note: undefined };
toJsonSafe(order);
// => { id: "9007199254740993n", placedAt: "1970-01-01T00:00:00.000Z", tags: ["a"] }

toJsonSafe(undefined); // => null
toJsonSafe(new Uint8Array(4)); // => "[Uint8Array: 4 bytes]"
```

`undefined` becomes `null` at the root and as an array element; an object property whose value is
`undefined` is dropped, as `JSON.stringify` does. A value's own `toJSON()` is honored before the
generic handling.

**Bounds** — three options, each defaulting when omitted:

| Option            | Default | Effect                                                                        |
| ----------------- | ------- | ----------------------------------------------------------------------------- |
| `maxDepth`        | 6       | Levels of nesting kept, the input itself counting as the first level.         |
| `maxBreadth`      | 100     | Entries kept per object or array; the rest are summarised by one marker.      |
| `maxStringLength` | 8192    | Characters kept per string; the rest are cut and suffixed with a marker.      |

**Markers** — a value that cannot be represented is replaced by a string that says why:

- `"[Circular]"` — an object that contains itself, where it recurs. The same object appearing twice
  as siblings is not circular and is walked in full both times.
- `"[Truncated]"` — a container nested deeper than `maxDepth`, replaced whole.
- `"[Truncated: N more]"` — the last item of an array, or the value under the `"…"` key of an
  object, when `N` entries beyond `maxBreadth` were dropped.
- `"[Unreadable]"` — a property whose getter throws, or a value that cannot be inspected at all,
  such as a revoked `Proxy`.
- `"…[truncated]"` — the suffix of a string cut at `maxStringLength`.

```ts
toJsonSafe({ a: { b: { c: 1 } } }, { maxDepth: 2 }); // => { a: { b: "[Truncated]" } }
toJsonSafe([1, 2, 3, 4], { maxBreadth: 2 }); // => [1, 2, "[Truncated: 2 more]"]
toJsonSafe("abcdef", { maxStringLength: 3 }); // => "abc…[truncated]"
```

Markers are advisory. An input string that happens to equal a marker is not escaped, so a reader
cannot tell it from the marker the serializer would have produced.

**Binary data** — a typed array, `DataView`, `ArrayBuffer` and `SharedArrayBuffer` are leaves,
described as `"[<ConstructorName>: <byteLength> bytes]"` and never expanded, at any depth. A Node
`Buffer` gives `"[Buffer: N bytes]"`, the same in Node and in the browser.

**Errors** — an `Error` becomes `{ type, message, stack? }`, one level only. Its `cause` and
`errors` are not followed; [`serializeError`](#serializeerror) is what serializes the chain.

### `serializeError`

`serializeError(value)` turns a thrown value and the chain behind it into a `SerializedError`, the
one error shape the logger and the error reporter share (ADR-0007). It never throws.

```ts
import { serializeError } from "@vipengele/ts-core-common/serialization";

const error = Object.assign(new Error("read failed", { cause: new Error("disk offline") }), { code: "EIO", path: "/tmp/a" });
serializeError(error);
// => { type: "Error", message: "read failed", code: "EIO", stack: "…",
//      data: { code: "EIO", path: "/tmp/a" },
//      cause: { type: "Error", message: "disk offline", stack: "…" } }

serializeError("boom"); // => { type: "Error", message: "boom", synthetic: true }
```

- `type`, `message` and `stack` are exactly what `toJsonSafe` gives for the same `Error`.
- `code` is a string `code` property: a `VipengeleError`'s code, or a Node errno code such as
  `"ENOENT"`.
- `data` holds the error's own enumerable properties, normalized as `normalizeAttributes` does.
  `cause` and `errors` are left out of it even when assigned directly, which makes them enumerable.
- `cause`, and every entry of an `errors` array such as an `AggregateError`'s, are serialized in
  turn, up to five links from the outermost error. A link further than that becomes
  `{ type: "[Truncated]", message: "the chain continues past 5 links" }`, and a link back to an
  error already on the path `{ type: "[Circular]", message: "an error already on this chain" }`.
  Beyond the first 100 entries of an `errors` array, one `"[Truncated]"` entry counts the rest.
- A thrown value that is not an `Error` gives `synthetic: true`, typed `Error`, with its JSON-safe
  form as the `message`: a string as it is, anything else as its JSON text.

## Levels

`Level` (`"trace" | "debug" | "info" | "warn" | "error" | "fatal"`) is the severity of a log record
or an error event, and `Threshold` (`Level | "off"`) the lowest one a logger or sink lets through.
Both types, and the values below, are exported from the package root.

`SEVERITY_NUMBERS` is a frozen table of each `Level`'s OpenTelemetry severity number — `trace` 1,
`debug` 5, `info` 9, `warn` 13, `error` 17, `fatal` 21 — and `SeverityNumber` is the type of those
six numbers. `isLevel(value)` narrows an `unknown` to a `Level`. It looks the string up as an own
property of the table, so inherited names such as `"constructor"` and the `"off"` threshold are
not levels.

```ts
import { isLevel, SEVERITY_NUMBERS } from "@vipengele/ts-core-common";

SEVERITY_NUMBERS.warn; // 13

isLevel("warn"); // true
isLevel("off"); // false
isLevel("constructor"); // false
```

## Clock

`Clock` (`() => number`) is a source of the current time as epoch milliseconds, carrying a
sub-millisecond fraction. `systemClock` is the default one, `performance.timeOrigin +
performance.now()`: the fraction comes from the monotonic high-resolution timer, so consecutive
calls never decrease, unlike `Date.now()`, which follows the adjustable wall clock. Both are
exported from the package root.

```ts
import { type Clock, systemClock } from "@vipengele/ts-core-common";

systemClock(); // e.g. 1704067200000.4
const fixed: Clock = () => 0; // a stand-in for a test
```
