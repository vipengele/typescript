---
about: Numeric takes an optional Locale only (omitted means Locale.default()), derives separators from Intl by Locale#tag, and caches by the canonical tag; an invalid tag throws RangeError from the Locale constructor, not from Numeric
saw:
  - source/core/packages/common/src/types/numeric/index.ts
  - source/core/packages/common/src/types/numeric/parse.ts
  - source/core/packages/common/src/types/numeric/format.ts
  - source/core/packages/common/src/types/numeric/locale-parts.ts
  - source/core/packages/common/src/locale/locale.ts
  - docs/adr/0013-locale-replaces-the-string-locale.md
---

- `Numeric.format(value, locale?: Locale, options?)`, `parse(str, locale?: Locale)`, `tryParse(str, locale?: Locale)`;
  the inner functions default the argument with `Locale.default()`, read on every call. A string is not accepted
  (ADR-0013). `tryParse` returns `{ success: false }` or `{ success: true, value }`.
- Separators come from `new Intl.NumberFormat(locale.tag, { numberingSystem: "latn", maximumFractionDigits: 1 })
  .formatToParts(-12345678.9)` (`locale-parts.ts`), never tabulated. `CACHE` (`locale-parts.ts`) and `FORMATTER_CACHE`
  (`format.ts`) are `Map<string, …>` keyed by `locale.tag`, so `new Locale("sv-se")` and `new Locale("sv-SE")` share an
  entry. No key is `undefined`: the invalid-tag `RangeError` is raised by `new Locale(tag)`, so a cache hit can never
  swallow it.
- Gotchas that remain: forced `numberingSystem: "latn"` (ASCII digits only; Arabic-Indic digits do not parse);
  U+200E/U+200F stripped before parsing (ar-EG/fa-IR prefix negatives with U+200E); group separators removed without
  position validation (en-IN); `format` throws `RangeError` on NaN and Infinity.
