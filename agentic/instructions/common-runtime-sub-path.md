---
description: "The runtime sub-path of ts-core-common is where runtime and capability detection lives; use it instead of probing globals."
---

# Runtime detection lives at `@vipengele/ts-core-common/runtime`

`@vipengele/ts-core-common` ships its surface as tree-shakeable sub-paths: `./types/numeric`,
`./types/date-time` (`LocalDate`, `LocalTime`, `LocalDateTime`: validated, immutable, zoneless civil
values with ISO 8601 parse and format, arithmetic and `now()`), `./locale`, `./context`, `./attributes`, `./serialization`, `./scope` and `./runtime`. `./runtime` holds
`detectRuntime` (`browser`, `worker`, `node`, `deno`, `bun`, `edge` or `unknown`) and
`detectCapability` (`consoleStyling`, `ansiColour`, `asyncContext`, `sendBeacon`,
`processExitHooks`). Ask it before reaching for `window`, `process` or another global directly. The
umbrella `@vipengele/ts` does not re-export it.
