/** A token bucket's shape: it holds at most `burst` tokens and gains `perMinute` tokens a minute. */
export interface TokenBucketOptions {
  /** The most tokens the bucket holds, and the number it starts with. */
  readonly burst: number;
  /** The tokens the bucket gains per minute of event time, up to `burst`. */
  readonly perMinute: number;
}

/** One token bucket. */
export interface TokenBucket {
  /**
   * Refills the bucket for the time elapsed since the latest epoch-ms time it was handed, then takes
   * one token when a whole one is there. Returns whether a token was taken.
   */
  take(epochMs: number): boolean;
}

const MS_PER_MINUTE = 60_000;

/**
 * Creates a token bucket that starts full and refills lazily from the epoch-ms time each `take` is
 * handed, so it reads no clock and runs no timer. A fraction of a token carries over to the next
 * refill. A time earlier than the latest one seen refills nothing and leaves the latest one in
 * place, so a clock that steps back never drains the bucket and never refills one interval twice.
 */
export function createTokenBucket({ burst, perMinute }: TokenBucketOptions): TokenBucket {
  let tokens = burst;
  let latest: number | undefined;
  return {
    take(epochMs) {
      if (latest === undefined) {
        latest = epochMs;
      } else if (epochMs > latest) {
        tokens = Math.min(burst, tokens + ((epochMs - latest) * perMinute) / MS_PER_MINUTE);
        latest = epochMs;
      }
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}
