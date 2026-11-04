import { createTokenBucket, type TokenBucket, type TokenBucketOptions } from "../token-bucket";

/** A token bucket's shape: it holds at most `burst` tokens and gains `perMinute` tokens a minute. */
export type RateLimitOptions = TokenBucketOptions;

/** A burst of 60, refilled at 60 tokens per minute (ADR-0020). */
export const DEFAULT_RATE_LIMIT: Readonly<RateLimitOptions> = Object.freeze({ burst: 60, perMinute: 60 });

/** One Reporter's token bucket. */
export type RateLimiter = TokenBucket;

/** Creates a Reporter's token bucket, which starts full and refills from the event times it is handed. */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  return createTokenBucket(options);
}
