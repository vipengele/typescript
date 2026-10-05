# A local time that a zone skips or repeats is settled by a `disambiguation` option

A zone's wall clock skips a span when its offset moves forward (a gap) and reads a span twice when
it moves back (an overlap). A date and time of day in such a span does not name exactly one instant,
so every place that resolves a local value in a zone takes one option:

```ts
type Disambiguation = "compatible" | "earlier" | "later" | "reject";

interface ZonedDateTimeOptions {
  readonly disambiguation?: Disambiguation; // "compatible" when omitted
}
```

| Mode         | Gap                                | Overlap                  |
| ------------ | ---------------------------------- | ------------------------ |
| `compatible` | moves forward by the gap's length  | the earlier instant      |
| `earlier`    | moves back by the gap's length     | the earlier instant      |
| `later`      | moves forward by the gap's length  | the later instant        |
| `reject`     | throws `ZoneResolutionError`       | throws `ZoneResolutionError` |

`compatible` is `java.time`'s default and is what `ZonedDateTime.of`, `LocalDateTime#atZone`,
`LocalDate#atStartOfDay` and the day and month arithmetic use when the option is omitted. A time
that names exactly one instant resolves to it under every mode. `ZoneResolutionError` extends
`VipengeleError` and is checked with `isZoneResolutionError` (ADR-0002).

`LocalDate#atStartOfDay` passes the option straight through, so `earlier` moves a skipped midnight
back by the gap's length into the previous date, and a gap that spans a whole date moves forward to
the next date the zone reads.

## One resolver for any gap size

`resolveLocal` classifies a local date-time by testing candidate offsets: the zone's offsets one day
before and one day after the local time read as UTC. Those bracket any transition near it, whatever
its size (Samoa skipped a whole date). An offset is kept when the instant `local - offset` reads in
the zone with that same offset; none kept is a gap, one a unique time, two an overlap. The zone's
rules are asked only through `ZoneId#offsetSecondsAt`, so the resolver holds no transition table and
agrees with the runtime's ICU data.

## Arithmetic splits by unit

- `plusDays`, `minusDays`, `plusMonths` and `minusMonths` move the local date at the same wall-clock
  time and re-resolve it in the zone under the `options` they are given. A day is a calendar day,
  so across a spring-forward it is 23 hours.
- `plusHours`, `plusMinutes`, `plusSeconds`, `plusNanos` and their `minus` forms move the instant by
  exactly that much elapsed time and read the result in the zone. An instant names one reading, so
  they take no options.

## Parsing is strict

`ZonedDateTime.parse` reads `<local date-time>±HH:mm[<zone>]` and nothing else: the offset and the
bracketed zone name are both required, and `Z` is not accepted. The offset must be one the zone
reads that local date-time in, so it never moves the value. In an overlap it picks which of the two
readings is meant, which makes `toString` and `parse` a lossless round trip for either; a time in a
gap has no agreeing offset and is rejected.

## The date-time modules import each other

`LocalDateTime`, `LocalDate` and `Instant` expose conversions that build a `ZonedDateTime`, which in
turn builds on them, so the modules import each other in a cycle. Each touches the others only
inside method bodies, never while it evaluates, so any of them can be the first loaded.
`import-order.test.ts` loads each first in a fresh module graph and runs a conversion across the
cycle; a top-level use of an imported class fails it.

## Considered options

- **`java.time`'s defaults only, with no option.** Simplest, and `compatible` covers most callers. A
  scheduling caller that must not silently shift a meeting, or must pick the second 01:30 of a
  fall-back night, would have no way to say so and would resolve the ambiguity itself with
  `resolveLocal`-style probing.
- **Separate methods per mode** (`atZoneEarlier`, `atZoneStrict`, ...). It multiplies the surface of
  every method that resolves a local value, and the arithmetic methods would need the same set. One
  option is accepted everywhere instead.
- **Free functions in a non-cyclic `conversions.ts`** (`atZone(localDateTime, zone)`), keeping the
  value classes unaware of `ZonedDateTime`. It removes the cycle but moves the conversions off the
  values they read from, where `date.atStartOfDay(zone)` is found by completion. The cycle is safe
  because of a rule a test pins, and Biome has no import-cycle rule to forbid it, so the rule is
  held by `import-order.test.ts` rather than by a linter.
