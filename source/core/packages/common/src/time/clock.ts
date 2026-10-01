/**
 * A source of the current time as epoch milliseconds, carrying a sub-millisecond fraction.
 */
export type Clock = () => number;

/**
 * The default {@link Clock}: `performance.timeOrigin + performance.now()`. The fraction comes
 * from the monotonic high-resolution timer, so consecutive calls never decrease, unlike
 * `Date.now()`, which follows the adjustable wall clock.
 */
export const systemClock: Clock = () => performance.timeOrigin + performance.now();
