import type { Clock } from "../time/clock";
import type { Scheduler } from "../time/scheduler";

/**
 * A virtual {@link Clock} and {@link Scheduler} over one shared timeline that moves only when
 * {@link ManualTime.advance} is called.
 */
export interface ManualTime {
  /** Returns the current virtual time in epoch milliseconds. */
  readonly clock: Clock;
  /**
   * Sleeps against the virtual timeline: a sleep registered at virtual time `t` fires once an
   * `advance` reaches `t + ms`. Abort handling matches `systemScheduler`.
   */
  readonly scheduler: Scheduler;
  /**
   * Moves virtual time forward by `ms`, firing every sleep whose deadline falls at or before
   * the target, earliest first and ties in registration order. Inside a fired sleep's
   * continuation `clock()` returns that sleep's deadline; once the last firing has drained,
   * virtual time settles at the target.
   *
   * After each firing, `advance` waits for one real `setTimeout(0)` so the continuation's
   * microtasks run before the next deadline is checked. The queue is read live, so a sleep a
   * continuation registers inside the window, `sleep(0)` included, fires in the same call.
   *
   * Manual time patches no globals and replaces fake timers rather than composing with them:
   * under `vi.useFakeTimers()` the `setTimeout(0)` hop never fires and `advance` never settles.
   *
   * Rejects with a `RangeError` for a negative or non-finite `ms`, and with a `TypeError` when
   * another `advance` is still in flight, including one called from a fired continuation.
   */
  advance(ms: number): Promise<void>;
  /** The number of sleeps registered and neither fired nor aborted. */
  readonly pendingSleeps: number;
}

interface PendingSleep {
  readonly deadline: number;
  readonly fire: () => void;
}

function rangeError(name: string, ms: number): RangeError {
  return new RangeError(`${name} expects a finite, non-negative number of milliseconds, got ${ms}`);
}

function hop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Creates a {@link ManualTime} whose virtual time starts at `startMs` epoch milliseconds.
 * Throws a `RangeError` when `startMs` is not finite.
 */
export function createManualTime(startMs = 0): ManualTime {
  if (!Number.isFinite(startMs)) {
    throw new RangeError(`createManualTime expects a finite start time, got ${startMs}`);
  }

  let now = startMs;
  let advancing = false;
  const queue: PendingSleep[] = [];

  const enqueue = (sleep: PendingSleep): void => {
    const index = queue.findIndex((pending) => pending.deadline > sleep.deadline);
    if (index === -1) {
      queue.push(sleep);
    } else {
      queue.splice(index, 0, sleep);
    }
  };

  const scheduler: Scheduler = {
    sleep(ms, signal) {
      if (!Number.isFinite(ms) || ms < 0) {
        return Promise.reject(rangeError("sleep", ms));
      }
      if (signal?.aborted) {
        return Promise.reject(signal.reason);
      }
      return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          queue.splice(queue.indexOf(entry), 1);
          reject(signal?.reason);
        };
        const entry: PendingSleep = {
          deadline: now + ms,
          fire: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        enqueue(entry);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };

  return {
    clock: () => now,
    scheduler,
    async advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) {
        throw rangeError("advance", ms);
      }
      if (advancing) {
        throw new TypeError("advance was called while another advance is still in flight");
      }
      advancing = true;
      const target = now + ms;
      try {
        for (let next = queue[0]; next !== undefined && next.deadline <= target; next = queue[0]) {
          queue.shift();
          now = next.deadline;
          next.fire();
          await hop();
        }
        now = target;
      } finally {
        advancing = false;
      }
    },
    get pendingSleeps() {
      return queue.length;
    },
  };
}
