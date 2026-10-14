---
about: resolveDateTimeLayout/formatDateTime/parseDateTime are internal to common's date-time module; LocalDateTime#segments is their one public face
saw:
  - source/core/packages/common/src/types/date-time/locale-format.ts
  - source/core/packages/common/src/types/date-time/index.ts
  - source/core/packages/common/src/types/date-time/local-date-time.ts
  - source/ts/packages/ts/src/index.ts
  - docs/adr/0003-ts-umbrella-package-naming-exception.md
---

Re-verified after the LocalDateTime#segments branch.

- `types/date-time/index.ts` still exports no `resolveDateTimeLayout`, `formatDateTime`, `parseDateTime` or
  `DateTimeLayout`. They are `export`ed from `locale-format.ts` for sibling modules only; `local-date-time.ts` is the
  sole consumer. They are not reachable through the `./types/date-time` sub-path.
- `LocalDateTime#segments(locale, options)` (`local-date-time.ts`) is how a consumer reaches the combined layout: it
  composes `this.date.segments`, `this.time.segments` and the layout literals `[before, between, after]` ordered by
  `timeFirst`, omitting empty literals. `DateTimeSegmentType` is `DateSegmentType | TimeSegmentType`, and both
  `DateTimeSegment` and the type are exported from the date-time `index.ts` and the umbrella `index.ts`.
- No ADR records `LocalDateTime#segments`; it mirrors `LocalDate#segments` and `LocalTime#segments`.
- ADR-0004 says the umbrella mirrors entry points with `export *`, but the code lists names (see the existing note
  umbrella-reexports-names-individually); a new core type needs a line in the umbrella's `export type` block.
