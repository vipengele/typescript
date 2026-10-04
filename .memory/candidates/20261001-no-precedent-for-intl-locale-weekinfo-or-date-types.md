---
about: Locale reads week info through an injected WeekInfoSource (getWeekInfo() or the weekInfo property, Monday fallback), the same injected-source seam detectCapability uses; engines differ on which shape they expose
saw:
  - source/core/packages/common/src/locale/locale.ts
  - source/core/packages/common/src/locale/locale.test.ts
  - source/core/packages/common/src/runtime/capabilities.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
---

- `readFirstDayOfWeek(tag, source = intlWeekInfoSource)` (`locale/locale.ts`) builds `new source(tag)` and prefers
  `getWeekInfo()` when it is a function, else the `weekInfo` property, else returns Monday (1). `firstDay` is already
  ISO-numbered (1 Monday..7 Sunday), so it is passed through unchanged. `Locale#firstDayOfWeek` caches the result per
  instance.
- The week-info source is injected so the missing-feature branch and both shapes are covered in the shared suite in both
  runtimes, with no `*.node.test.ts` split. This follows the injected-source convention of `detectCapability(cap, source?)`
  (`runtime/capabilities.ts`, ADR-0004).
- Engines differ: Node 22 exposes only the `weekInfo` property, with no `getWeekInfo()`; Chromium and Node 24 expose
  `getWeekInfo()`. Real-locale expectations (en-US 7, de-DE 1, ar-EG 6) hold under both shapes.
- `Intl.Locale` is typed without week info in the ES2022 lib, so the default source is retyped with a cast
  (`intlWeekInfoSource`), not matched structurally.
