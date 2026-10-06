---
about: LocalTime and LocalDateTime hold a nano-of-second (not a millisecond); one shared fraction codec prints and parses it, and now() floors the clock to the microsecond without ever multiplying the whole epoch by 1000
saw:
  - source/core/packages/common/src/types/date-time/fraction.ts
  - source/core/packages/common/src/types/date-time/now.ts
  - source/core/packages/common/src/types/date-time/civil-fields.ts
  - source/core/packages/common/src/types/date-time/instant.ts
  - source/core/packages/common/src/types/date-time/local-time.ts
  - source/core/packages/common/src/types/date-time/now.test.ts
  - docs/adr/0014-nanosecond-precision-for-date-time-values.md
---
- `fraction.ts` (`formatFraction`, `parseFraction`) is the one place a nano-of-second fraction is printed (shortest exact 3, 6 or 9 digits) and parsed (1 to 9 digits, right-padded, never rounded). It is not exported from the package index; `local-time.ts` and `instant.ts` import it, so every value that carries a nano-of-second agrees on the digits.
- `local-time.ts`'s ISO regex takes `\d+` for the fraction on purpose: `parseFraction` alone decides the nine-digit limit, so a ten-digit fraction fails there rather than in two places.
- `civilFieldsAt` in `civil-fields.ts` (called by `civilNow` in `now.ts`) and `Instant.now` in `instant.ts` each take the whole millisecond from `Math.floor(reading)` and scale only the sub-millisecond remainder. `Math.floor(reading * 1000)` is exact only while the product stays a safe integer for fractional values and a representable multiple for whole-millisecond ones (about year 4250); a far-future fixed clock then returns a fraction up to ~16 microseconds early. The remainder times 1000 can round to exactly 1000 (a reading like -1e-20 ms), so the microsecond is clamped to 999; without the clamp the nanosecond overflows past 999,999,999.
- `now.test.ts` uses dyadic sub-millisecond fractions (0.4375, 2**-9, -(2**-11)) because they are exact in a double, which makes floor-versus-round and pre-epoch (1969, not 1970) assertions deterministic; its `useSystemClock` helper pins `performance.timeOrigin` to 0 and mocks `performance.now`.
- ADR 0014 records the model: `Clock` stays an epoch-millisecond double, nanoseconds are a capacity of the data model and not something `now()` produces.
