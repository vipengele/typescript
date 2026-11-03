const DELTA_SECONDS = /^\d+$/;
const HAS_LETTER = /[A-Za-z]/;

/**
 * Reads a `Retry-After` header value (RFC 9110) as a delay in milliseconds. Delta-seconds is
 * digits only, surrounding whitespace allowed; anything else is read as an HTTP-date relative to
 * `nowMs`, and a date in the past gives `0`. A missing, empty or unreadable value gives
 * `undefined`. `nowMs` comes from the caller's Clock so the result is deterministic.
 *
 * A date must contain a letter (a weekday or month name): `Date.parse` would otherwise accept a
 * bare number such as `"2026-10-30"` as a date.
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null) {
    return undefined;
  }
  const value = header.trim();
  if (DELTA_SECONDS.test(value)) {
    const delayMs = Number(value) * 1000;
    return Number.isFinite(delayMs) ? delayMs : undefined;
  }
  if (!HAS_LETTER.test(value)) {
    return undefined;
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - nowMs);
}
