const NANOS_PER_MILLI = 1_000_000n;

/** Digits of a millisecond fraction down to the nanosecond. */
const FRACTION_DIGITS = 6;

/**
 * Epoch milliseconds, sub-millisecond fraction included, as the decimal integer string of epoch
 * nanoseconds an OTLP/HTTP JSON `fixed64` time field carries.
 *
 * The conversion works on the number's shortest decimal text, not on `ms * 1e6`: a double near the
 * present epoch resolves only about a quarter of a microsecond, so multiplying writes that binary
 * noise into the low digits, and `1700000000123.456` would not give `"1700000000123456000"`.
 * Digits past the nanosecond are dropped. OTLP's time is unsigned and `0` means unknown, so a
 * negative or non-finite input gives `"0"`.
 */
export function millisToNanoString(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0";
  }
  const text = String(ms);
  if (text.includes("e")) {
    // Exponent notation is only produced at or above 1e21, where the number is an integer, or
    // below 1e-6, which is under one nanosecond.
    return ms >= 1 ? (BigInt(ms) * NANOS_PER_MILLI).toString() : "0";
  }
  const [whole = "0", fraction = ""] = text.split(".");
  const digits = `${whole}${fraction.padEnd(FRACTION_DIGITS, "0").slice(0, FRACTION_DIGITS)}`;
  return digits.replace(/^0+(?=\d)/, "");
}
