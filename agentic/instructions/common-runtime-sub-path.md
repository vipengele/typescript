---
description: "The runtime sub-path of ts-core-common is where runtime and capability detection lives; use it instead of probing globals."
---

# Runtime detection lives at `@vipengele/ts-core-common/runtime`

`@vipengele/ts-core-common` ships its surface as tree-shakeable sub-paths: `./types/numeric`,
`./types/date-time` (`LocalDate`, `LocalTime`, `LocalDateTime`: validated, immutable, zoneless civil
values with ISO 8601 parse and format, arithmetic, `now()`, locale-aware `format`/`parseLocalized`/
`tryParseLocalized`, and `LocalDate#segments`; `Instant`, a nanosecond point on the UTC timeline;
`ZoneId`, a named time zone with `offsetSecondsAt`; `ZonedDateTime`, a date and time of day in a
zone, built by `LocalDateTime#atZone`, `LocalDate#atStartOfDay` and `Instant#atZone`, with a
`disambiguation` option for a skipped or repeated local time and a `ZoneResolutionError` for
`reject`), `./locale`, `./context`, `./attributes`, `./serialization`, `./scope` and `./runtime`. `./runtime` holds
`detectRuntime` (`browser`, `worker`, `node`, `deno`, `bun`, `edge` or `unknown`) and
`detectCapability` (`consoleStyling`, `ansiColour`, `asyncContext`, `sendBeacon`,
`processExitHooks`). Ask it before reaching for `window`, `process` or another global directly. The
umbrella `@vipengele/ts` re-exports the numeric, locale, date-time, scope, attributes and redaction
surface, but not `./runtime`.
