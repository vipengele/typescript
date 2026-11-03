/**
 * What an export's HTTP status means for the batch: `"delivered"` for any 2xx, `"retryable"` for
 * the statuses the OTLP/HTTP specification names as transient, `"rejected"` for every other status.
 */
export type StatusClass = "delivered" | "retryable" | "rejected";

/** The statuses OTLP/HTTP retries: throttling and the three transient gateway and server failures. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** A `Retry-After` given as delta-seconds: digits only, surrounding whitespace allowed. */
const DELTA_SECONDS = /^\s*(\d+)\s*$/;

/**
 * Every HTTP-date form (IMF-fixdate, RFC 850, asctime) opens with a day name. `Date.parse` alone
 * also reads text that is no date at all — `"-5"` as a year — so the day name gates it.
 */
const HTTP_DATE = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/;

/** Classifies the HTTP `status` an export attempt received. */
export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) {
    return "delivered";
  }
  return RETRYABLE_STATUSES.has(status) ? "retryable" : "rejected";
}

/**
 * Reads a `Retry-After` header `value` as a delay in milliseconds before the next attempt.
 * Delta-seconds give that many seconds; an HTTP-date gives the time from `nowMs` (epoch
 * milliseconds) until that date, 0 once it has passed. An absent or unreadable value gives
 * `undefined`, leaving the delay to the backoff.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = DELTA_SECONDS.exec(value)?.[1];
  if (seconds !== undefined) {
    return Number(seconds) * 1000;
  }
  const date = HTTP_DATE.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, date - nowMs);
}
