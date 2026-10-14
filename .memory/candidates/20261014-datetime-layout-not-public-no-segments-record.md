---
about: resolveDateTimeLayout/formatDateTime/parseDateTime are internal to common's date-time module, and no ADR records a LocalDateTime#segments decision
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/index.ts
  - source/core/packages/common/src/types/date-time/local-date-time.ts
  - source/ts/packages/ts/src/index.ts
  - docs/adr/0003-ts-umbrella-package-naming-exception.md
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
---

Checked for issue 144 planning.

- `types/date-time/index.ts` exports no `resolveDateTimeLayout`, `formatDateTime`, `parseDateTime` or `DateTimeLayout`
  (only DateSegment/TimeSegment types and the value classes). They are `export`ed from `locale-format.ts:726,734,748,420`
  for sibling modules only; `local-date-time.ts:7,31,216` is the sole consumer. So they are not reachable through the
  `./types/date-time` sub-path, and an umbrella re-export would first need a core index export.
- `grep -rn segment docs/adr CONTEXT.md` finds nothing on date/time segments: no ADR (0003, 0013, 0014, 0015)
  records LocalDateTime#segments as considered or rejected. Release notes v0.1.0 (LocalDate#segments) and v0.2.0
  (LocalTime#segments) just add them. LocalDateTime has only `format`/`parseLocalized` (`local-date-time.ts:216`).
- `DateTimeLayout` = `{ timeFirst, literals: [before, between, after] }` (`locale-format.ts:420-423`), derived from Intl
  combined output (`layoutDateTime`, `:654`); FALLBACK_LAYOUT is date, space, time (`:453`). A segments accessor would
  need these literals plus `dateSegments`/`timeSegments`; `DateSegmentType` (`:299`) and `TimeSegmentType` (`:568`)
  both contain "literal", and a combined type would be their union.
- ADR-0004 says the umbrella mirrors entry points with `export *`, but the code lists names (see the existing note
  umbrella-reexports-names-individually). Umbrella test pattern: `index.test.ts:96` asserts identity with the core export.
- umbrella-reexports-names-individually: verdict still-true; index.ts line pointers shifted (the date-time export
  block is now at lines 4-20, type block 21-30).
