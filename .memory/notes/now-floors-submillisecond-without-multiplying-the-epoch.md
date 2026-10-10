---
name: now-floors-submillisecond-without-multiplying-the-epoch
kind: gotcha
description: civilFieldsAt takes the whole millisecond from Math.floor(reading) and scales only the sub-millisecond remainder, clamping the microsecond to 999; floor(reading * 1000) goes inexact past about year 4250.
anchors:
  - path: source/core/packages/common/src/types/date-time/civil-fields.ts
    blob: c32124d26900
  - path: source/core/packages/common/src/types/date-time/instant.ts
    blob: cb02f8d92dcf
confidence: suspect
---

`civil-fields.ts:63` takes `Math.floor(epochMilliseconds)` as the whole millisecond, and `:78` scales
only the remainder: `Math.min(Math.floor((epochMilliseconds - wholeMilliseconds) * 1000), 999)`. The
clamp matters because a remainder like -1e-20 ms scales to exactly 1000, which would overflow the
nanosecond field past 999,999,999 (`:87`). Computing `Math.floor(reading * 1000)` instead stops being
exact once the product leaves the safe-integer range for whole-millisecond readings (about year 4250),
so a far-future fixed clock would come back up to ~16 microseconds early.

Suspect: the year-4250 threshold and the same pattern in `Instant.now` are reported by the explorer
and not re-derived here.
