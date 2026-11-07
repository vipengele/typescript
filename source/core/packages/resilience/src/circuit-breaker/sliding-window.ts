import type { Clock } from "@vipengele/ts-core-common";

/**
 * The shape of a {@link SlidingWindow}: `"count"` keeps the last `size` outcomes, `"time"` keeps
 * the outcomes recorded in the last `size` milliseconds.
 */
export interface SlidingWindowConfig {
  readonly type: "count" | "time";
  readonly size: number;
}

/** The outcomes a {@link SlidingWindow} holds at one moment. */
export interface SlidingWindowSnapshot {
  /** Every outcome in the window, failed or not. */
  readonly buffered: number;
  /** The outcomes in the window recorded as failed. */
  readonly failed: number;
}

/** A bounded record of recent call outcomes. */
export interface SlidingWindow {
  record(failed: boolean): void;
  snapshot(): SlidingWindowSnapshot;
  clear(): void;
}

/** The number of buckets a time window aims for; its edge is accurate to one bucket's width. */
const TARGET_BUCKETS = 100;

/**
 * Creates the {@link SlidingWindow} `config` describes. A time window reads `clock` on every
 * `record` and `snapshot`; a count window never reads it.
 */
export function createSlidingWindow(config: SlidingWindowConfig, clock: Clock): SlidingWindow {
  return config.type === "count" ? createCountWindow(config.size) : createTimeWindow(config.size, clock);
}

/**
 * A ring of the last `size` outcomes: once full, each record overwrites the oldest one, so memory
 * is `size` bytes however many calls are recorded.
 */
function createCountWindow(size: number): SlidingWindow {
  const outcomes = new Uint8Array(size);
  let next = 0;
  let buffered = 0;
  let failed = 0;

  return {
    record(isFailure) {
      if (buffered === size) {
        failed -= outcomes[next] as number;
      } else {
        buffered += 1;
      }
      const outcome = isFailure ? 1 : 0;
      outcomes[next] = outcome;
      failed += outcome;
      next = (next + 1) % size;
    },
    snapshot: () => Object.freeze({ buffered, failed }),
    clear() {
      outcomes.fill(0);
      next = 0;
      buffered = 0;
      failed = 0;
    },
  };
}

/**
 * Aggregated buckets of `max(1, ceil(sizeMs / 100))` ms, at most 100 of them whatever the
 * throughput. The window covers the newest bucket, the one `clock()` falls in, and the buckets
 * before it up to the bucket count, so its edge is accurate to one bucket. Buckets that fall out
 * of the window are evicted lazily on every `record` and `snapshot`. A clock reading earlier than
 * the newest bucket lands in the newest bucket and evicts nothing.
 */
function createTimeWindow(sizeMs: number, clock: Clock): SlidingWindow {
  const bucketMs = Math.max(1, Math.ceil(sizeMs / TARGET_BUCKETS));
  const bucketCount = Math.ceil(sizeMs / bucketMs);
  const calls = new Float64Array(bucketCount);
  const failures = new Float64Array(bucketCount);
  let head = 0;
  let newest = bucketOf(clock(), bucketMs);
  let buffered = 0;
  let failed = 0;

  const evict = (slot: number): void => {
    buffered -= calls[slot] as number;
    failed -= failures[slot] as number;
    calls[slot] = 0;
    failures[slot] = 0;
  };

  const reset = (): void => {
    calls.fill(0);
    failures.fill(0);
    buffered = 0;
    failed = 0;
  };

  const advance = (): void => {
    const current = bucketOf(clock(), bucketMs);
    const steps = current - newest;
    if (steps <= 0) {
      return;
    }
    newest = current;
    if (steps >= bucketCount) {
      reset();
      return;
    }
    for (let step = 0; step < steps; step += 1) {
      head = (head + 1) % bucketCount;
      evict(head);
    }
  };

  return {
    record(isFailure) {
      advance();
      const outcome = isFailure ? 1 : 0;
      calls[head] = (calls[head] as number) + 1;
      failures[head] = (failures[head] as number) + outcome;
      buffered += 1;
      failed += outcome;
    },
    snapshot() {
      advance();
      return Object.freeze({ buffered, failed });
    },
    clear: reset,
  };
}

function bucketOf(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs);
}
