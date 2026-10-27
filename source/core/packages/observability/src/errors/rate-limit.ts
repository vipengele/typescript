/** A token bucket's shape: it holds at most `burst` tokens and gains `perMinute` tokens a minute. */
export interface RateLimitOptions {
  /** The most tokens the bucket holds, and the number it starts with. */
  readonly burst: number;
  /** The tokens the bucket gains per minute of event time, up to `burst`. */
  readonly perMinute: number;
}

/** A burst of 60, refilled at 60 tokens per minute (ADR-0020). */
export const DEFAULT_RATE_LIMIT: Readonly<RateLimitOptions> = Object.freeze({ burst: 60, perMinute: 60 });

/** One Reporter's token bucket. */
export interface RateLimiter {
  /**
   * Refills the bucket for the time elapsed since the latest `time` it was handed, then takes one
   * token when a whole one is there. Returns whether a token was taken.
   */
  take(time: number): boolean;
}

const MS_PER_MINUTE = 60_000;

/**
 * Creates a token bucket that starts full and refills lazily from the epoch-ms `time` each `take`
 * is handed, so it reads no clock and runs no timer. A fraction of a token carries over to the next
 * refill. A `time` earlier than the latest one seen refills nothing and leaves the latest one in
 * place, so a clock that steps back never drains the bucket and never refills one interval twice.
 */
export function createRateLimiter({ burst, perMinute }: RateLimitOptions): RateLimiter {
  let tokens = burst;
  let latest: number | undefined;
  return {
    take(time) {
      if (latest === undefined) {
        latest = time;
      } else if (time > latest) {
        tokens = Math.min(burst, tokens + ((time - latest) * perMinute) / MS_PER_MINUTE);
        latest = time;
      }
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}
