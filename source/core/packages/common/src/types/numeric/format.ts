/** Options accepted by {@link format}. */
export interface FormatOptions {
  /**
   * Digits kept after the decimal separator. Defaults to 20, the largest value
   * `Intl.NumberFormat` accepts.
   */
  readonly maximumFractionDigits?: number;
}

/**
 * `Intl.NumberFormat` defaults `maximumFractionDigits` to 3, which rounds `0.123456789` to
 * `0.123` without saying so. 20 is the ceiling the specification allows and keeps every digit a
 * `number` can carry.
 */
const DEFAULT_MAXIMUM_FRACTION_DIGITS = 20;

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

  return new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    maximumFractionDigits: options?.maximumFractionDigits ?? DEFAULT_MAXIMUM_FRACTION_DIGITS,
  }).format(value);
}
