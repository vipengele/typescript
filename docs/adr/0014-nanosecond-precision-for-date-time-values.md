# `LocalTime` and `LocalDateTime` hold a nanosecond, and `now()` reads to the microsecond

`LocalTime` and `LocalDateTime` store their sub-second part as a `nanosecond` from 0 to
999,999,999, the data model `java.time` uses. `LocalTime.of(hour, minute, second = 0, nanosecond = 0)`
and `LocalDateTime.ofFields(..., second = 0, nanosecond = 0)` take it as the last argument.

`Clock` stays what it is: an epoch-millisecond double carrying a sub-millisecond fraction.
`now()` floors that reading to the microsecond, so the last three digits of a `now()` value's
`nanosecond` are zero. Nanoseconds are a capacity of the data model, not something `now()`
produces: a double resolves about 0.24 µs at current epochs, and browsers coarsen their clocks
further, so a finer reading would be digits the clock never measured.

ISO 8601 output is `HH:mm`, with `:ss` when the second or the nanosecond is non-zero, and a
fraction only when the nanosecond is non-zero, written as the shortest exact 3, 6 or 9 digits
(`.123`, `.123456`, `.123456789`). ISO input accepts `HH:mm`, `HH:mm:ss` and `HH:mm:ss.f` with one
to nine fraction digits, right-padded and never rounded. One module, `fraction.ts`, prints and
parses the fraction, so every type that carries a nano-of-second agrees on the digits.

## Why nanoseconds

The zoned types that follow, an instant and a zoned date-time, need sub-millisecond capacity: an
instant read from a high-resolution source, or parsed from a timestamp a server wrote with six or
nine fraction digits, must survive a round trip. A civil time that holds less than the instant it
is derived from would lose digits at the boundary between them.

Widening the field after a release changes the type of a public property, the arguments of `of`
and `ofFields`, and the text `toString` writes. While the package is unreleased nothing depends on
the old shape, so the choice costs nothing now and a migration later.

## Considered options

- **Keep milliseconds.** It matches `Date` and the `Clock` reading, and is the smallest model. It
  also fixes the precision the zoned types can hold at the first one a consumer meets, and a
  timestamp with microsecond or nanosecond digits would be rounded or rejected on parse. Moving
  to a finer unit later is breaking for every consumer that reads the field.
- **Microseconds.** It is as fine as `now()` can honestly read, so it would never carry a digit
  the clock did not measure. It is also an arbitrary stopping point: timestamps from tracing and
  logging systems routinely carry nine digits, and a model that cannot hold them loses data that
  `java.time`, the model most consumers already know, keeps.
- **Nanoseconds (chosen).** The model holds any fraction an ISO 8601 text or another system
  writes, up to nine digits. The trade-off is that the capacity exceeds what `now()` reads, which
  is surprising without this record, hence the floor to the microsecond: a value from `now()`
  never claims precision the clock does not have.
