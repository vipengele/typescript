---
about: Bookkeeping that bears on adding ZoneId/Instant/ZonedDateTime - they join the existing ./types/date-time sub-path (no new exports/tsup entry), the umbrella needs names and an identity test, v0.1.0 notes are still unreleased, and lydite's mutation check demands per-branch assertions
saw:
  - source/core/packages/common/src/types/date-time/index.ts
  - source/core/packages/common/src/types/date-time/index.test.ts
  - source/core/packages/common/src/package-exports.test.ts
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/src/index.test.ts
  - source/ts/packages/ts/README.md
  - source/core/packages/common/README.md
  - docs/release-notes/v0.1.0.md
  - handoff/done/20261004-1004-local-date-time-locale-and-release.md
---
- `./types/date-time` already has an `exports` key and a tsup entry; new types exported from `types/date-time/index.ts` need neither, so `package-exports.test.ts` is untouched. `types/date-time/index.test.ts` pins the export list and must be extended.
- Umbrella `source/ts/packages/ts/src/index.ts:9-13` names each export; `index.test.ts:65` has the identity test (`expect(LocalDate).toBe(CoreLocalDate)`) to copy per new name. READMEs: `source/core/packages/common/README.md:171-240` (`./types/date-time` section) and `source/ts/packages/ts/README.md:7-10,63-86`; plus the sub-path prose in CLAUDE.md sources (`agentic/vipengele-typescript.md`, then `agtk render`).
- Common is at 0.0.2 (`source/core/packages/common/package.json:3`) and `docs/release-notes/v0.1.0.md` already documents date-time under "core / ts-core-common / ./types/date-time", so v0.1.0 is not yet released: add the zoned types to that bullet, not a new file.
- Errors: existing codes `common.date-time.invalid` and `common.date-time.parse` (`errors.ts:4,7`), classes extend `VipengeleError`, guards check `instanceof Error` plus `code` only. New errors follow the `common.date-time.<kind>` pattern with a paired `isXError` guard (ADR-0002).
- Mutation: the handoff (`handoff/done/20261004-1004-...md:104-106`) says lydite's mutation check runs in CI and "a statement whose removal no test notices fails it, so assert the behaviour of each branch rather than only reaching it". Cache-population statements, `Object.freeze(this)`, and defensive guards reached but not asserted are the usual survivors; caching needs an observable (e.g. spy on `Intl.DateTimeFormat` construction count). Not run locally; mechanism inferred from that handoff only.
- Tests run in node and chromium (`vitest.shared.ts`), so zone-dependent expectations must hold in both; pin the system zone by spying `resolvedOptions` as `now.test.ts` does, not `process.env.TZ`.
