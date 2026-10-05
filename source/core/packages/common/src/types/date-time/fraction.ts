/**
 * The decimal fraction of a second as ISO 8601 writes it, read from and written to a whole number
 * of nanoseconds. Every value that carries a nano-of-second prints and parses its fraction here,
 * so they all agree on the digits.
 */

/** One to nine ASCII digits: a fraction of a second down to the nanosecond. */
const FRACTION_DIGITS = /^\d{1,9}$/;

/**
 * The fraction `nanoOfSecond` (an integer from 0 to 999 999 999) writes after a seconds field: a
 * `.` and the shortest of 3, 6 or 9 digits that holds it exactly, or `""` when it is zero.
 * `.250`, `.123456`, `.000000001`.
 */
export function formatFraction(nanoOfSecond: number): string {
  if (nanoOfSecond === 0) {
    return "";
  }
  const digits = String(nanoOfSecond).padStart(9, "0");
  if (nanoOfSecond % 1_000_000 === 0) {
    return `.${digits.slice(0, 3)}`;
  }
  if (nanoOfSecond % 1_000 === 0) {
    return `.${digits.slice(0, 6)}`;
  }
  return `.${digits}`;
}

/**
 * The nano-of-second the fraction digits `digits` (without the `.`) spell, or `undefined` unless
 * they are one to nine ASCII digits. The digits are a decimal of a second, right-padded rather
 * than rounded: `5` is 500 000 000 ns and `05` is 50 000 000 ns.
 */
export function parseFraction(digits: string): number | undefined {
  return FRACTION_DIGITS.test(digits) ? Number(digits.padEnd(9, "0")) : undefined;
}
