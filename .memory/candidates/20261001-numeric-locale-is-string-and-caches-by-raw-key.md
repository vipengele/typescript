---
about: Numeric takes `locale?: string` only, derives separators and caches from Intl by the raw locale string; tryParse returns {success,value?}; invalid tag throws RangeError unwrapped
saw:
  - source/core/packages/common/src/types/numeric/index.ts
  - source/core/packages/common/src/types/numeric/parse.ts
  - source/core/packages/common/src/types/numeric/format.ts
  - source/core/packages/common/src/types/numeric/locale-parts.ts
  - source/core/packages/common/src/types/numeric/numeric-parse-error.ts
---

Read in full for the LocalDate/Locale planning (issue #87).

- Static-only class `Numeric` (`index.ts:9-24`): `format(value: number, locale?: string, options?: FormatOptions): string`,
  `parse(str: string, locale?: string): number`, `tryParse(str: string, locale?: string): TryParseResult`.
  Locale is a plain optional `string` (not string[], not Intl.Locale); omitted means runtime default locale.
- `TryParseResult = { readonly success: boolean; readonly value?: number }` (`parse.ts:4-9`); failure is
  `{ success: false }`, never undefined. `FormatOptions` has only `maximumFractionDigits` (default 20, `format.ts:13`).
- Error: `NumericParseError extends VipengeleError`, code `"common.numeric.parse"`, guard `isNumericParseError`
  is `instanceof Error && code ===` (`numeric-parse-error.ts:4-22`).
- An invalid BCP 47 tag throws `RangeError` out of parse AND tryParse unwrapped (programmer error, `parse.ts` docs);
  format also throws RangeError on NaN/Infinity.
- Intl: separators come from `new Intl.NumberFormat(locale,{numberingSystem:"latn",maximumFractionDigits:1}).formatToParts(-12345678.9)`
  (`locale-parts.ts:32-60`), never tabulated. Two Map caches (`locale-parts.ts` CACHE, `format.ts` FORMATTER_CACHE)
  keyed by the raw locale string with `undefined` a distinct key from `""` (otherwise "" would skip its RangeError).
  A Locale value type that normalizes keys must preserve this: a cache hit must not swallow an invalid-tag RangeError.
- Gotchas: forced `numberingSystem:"latn"` (ASCII digits only; Arabic-Indic digits do not parse); U+200E/U+200F etc.
  stripped before parsing (ar-EG/fa-IR prefix negatives with U+200E); lookalike-codepoint ASCII_EQUIVALENTS map
  (see note ascii-equivalents-keys-are-lookalike-codepoints); group separators removed without position validation (en-IN).
- Passing a `Locale` to Numeric.tryParse/format means changing all three string-typed signatures and both cache key types.
