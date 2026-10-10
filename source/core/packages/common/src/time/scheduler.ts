/**
 * A source of delays. Code that waits takes a `Scheduler` instead of calling `setTimeout`
 * directly, so a caller can substitute a scheduler it controls.
 */
export interface Scheduler {
  /**
   * Resolves after `ms` milliseconds. An aborted `signal` rejects the returned promise with
   * `signal.reason` and cancels the wait. A negative or non-finite `ms` rejects with a
   * `RangeError`.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/**
 * The default {@link Scheduler}, backed by `setTimeout`. A signal that is already aborted
 * rejects without starting a timer, and an abort while sleeping clears the timer. The abort
 * listener is removed once the sleep resolves, so an abort afterwards does nothing.
 */
export const systemScheduler: Scheduler = {
  sleep(ms, signal) {
    if (!Number.isFinite(ms) || ms < 0) {
      return Promise.reject(new RangeError(`sleep expects a finite, non-negative number of milliseconds, got ${ms}`));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(handle);
        reject(signal?.reason);
      };
      const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};
