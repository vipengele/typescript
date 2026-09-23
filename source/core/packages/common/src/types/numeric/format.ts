/** Options accepted by {@link format}. */
export interface FormatOptions {
  /**
   * Digits kept after the decimal separator. Defaults to 20.
   */
  readonly maximumFractionDigits?: number;
}

/**
 * `Intl.NumberFormat` defaults `maximumFractionDigits` to 3, which rounds `0.123456789` to
 * `0.123` without saying so. 20 covers every digit a `number`'s magnitude typically carries;
 * ECMA-402 allows up to 100, but a value with significant digits smaller than 1e-20 still loses
 * them at this default and needs an explicit `maximumFractionDigits` to keep them.
 */
const DEFAULT_MAXIMUM_FRACTION_DIGITS = 20;

/**
 * Keyed by locale exactly as passed (`undefined` its own key, distinct from `""` — see
 * `locale-parts.ts`'s `CACHE` for why the two cannot share one), then by
 * `maximumFractionDigits`. Locale negotiation and CLDR resolution are the expensive part of
 * building an `Intl.NumberFormat`, and both are fixed for the process's lifetime.
 */
const FORMATTER_CACHE = new Map<string | undefined, Map<number, Intl.NumberFormat>>();

function resolveFormatter(locale: string | undefined, maximumFractionDigits: number): Intl.NumberFormat {
  let byFractionDigits = FORMATTER_CACHE.get(locale);
  if (byFractionDigits === undefined) {
    byFractionDigits = new Map();
    FORMATTER_CACHE.set(locale, byFractionDigits);
  }

  let formatter = byFractionDigits.get(maximumFractionDigits);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { numberingSystem: "latn", maximumFractionDigits });
    byFractionDigits.set(maximumFractionDigits, formatter);
  }

  return formatter;
}

/**
 * Formats `value` for `locale`, or for the runtime's default locale when `locale` is omitted.
 *
 * `numberingSystem: "latn"` is forced, so the digits are always ASCII 0-9 even for a locale
 * whose default numbering system is not — `ar-EG` formats through this as `1,234,567.89`, not
 * with Arabic-Indic digits. Everything else about the locale survives: its separator characters
 * and its grouping pattern, including irregular ones such as `en-IN`'s `12,34,567.89`.
 *
 * @throws {RangeError} when `value` is `NaN`, `Infinity` or `-Infinity`, or when `locale` is not
 * a structurally valid BCP 47 language tag.
 */
export function format(value: number, locale?: string, options?: FormatOptions): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot format the non-finite number ${value}.`);
  }

  const maximumFractionDigits = options?.maximumFractionDigits ?? DEFAULT_MAXIMUM_FRACTION_DIGITS;
  return resolveFormatter(locale, maximumFractionDigits).format(value);
}
