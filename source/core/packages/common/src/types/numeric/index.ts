import { format, type FormatOptions } from "./format";
import { isNumericParseError, NumericParseError } from "./numeric-parse-error";
import { parse, tryParse, type TryParseResult } from "./parse";

/**
 * Locale-aware formatting and parsing of numbers, gathered behind one static-only class so a
 * consumer imports a single name for both directions of the round trip.
 */
export class Numeric {
  /** @see {@link format} */
  static format(value: number, locale?: string, options?: FormatOptions): string {
    return format(value, locale, options);
  }

  /** @see {@link parse} */
  static parse(str: string, locale?: string): number {
    return parse(str, locale);
  }

  /** @see {@link tryParse} */
  static tryParse(str: string, locale?: string): TryParseResult {
    return tryParse(str, locale);
  }
}

export { NumericParseError, isNumericParseError };
export type { FormatOptions, TryParseResult };
