import type { Clock } from "@vipengele/ts-core-common";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import { createSlidingWindow, type SlidingWindow } from "./sliding-window";

const START = 1_000;

function recordAll(window: SlidingWindow, outcomes: readonly boolean[]): void {
  for (const failed of outcomes) {
    window.record(failed);
  }
}

describe("count window", () => {
  function countWindow(size: number): SlidingWindow {
    return createSlidingWindow({ type: "count", size }, createManualTime(START).clock);
  }

  test("starts empty", () => {
    expect(countWindow(3).snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("a partly filled ring holds every outcome recorded", () => {
    const window = countWindow(5);

    recordAll(window, [true, false, true]);

    expect(window.snapshot()).toEqual({ buffered: 3, failed: 2 });
  });

  test("a full ring overwrites its oldest outcome", () => {
    const window = countWindow(3);

    recordAll(window, [true, true, false]);
    expect(window.snapshot()).toEqual({ buffered: 3, failed: 2 });

    window.record(false);
    expect(window.snapshot()).toEqual({ buffered: 3, failed: 1 });

    window.record(true);
    expect(window.snapshot()).toEqual({ buffered: 3, failed: 1 });
  });

  test("wraps around the ring more than once", () => {
    const window = countWindow(3);

    recordAll(window, [true, true, true, false, false, false, true, false]);

    expect(window.snapshot()).toEqual({ buffered: 3, failed: 1 });
  });

  test("a ring of one holds only the latest outcome", () => {
    const window = countWindow(1);

    window.record(true);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });

    window.record(false);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 0 });
  });

  test("clear empties the ring and it refills from the start", () => {
    const window = countWindow(3);
    recordAll(window, [true, true, true, true]);

    window.clear();
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });

    recordAll(window, [false, true]);
    expect(window.snapshot()).toEqual({ buffered: 2, failed: 1 });
  });

  test("never reads the clock", () => {
    const clock = vi.fn<Clock>(() => START);
    const window = createSlidingWindow({ type: "count", size: 2 }, clock);

    recordAll(window, [true, false, true]);
    window.snapshot();
    window.clear();

    expect(clock).not.toHaveBeenCalled();
  });

  test("snapshots are frozen", () => {
    expect(Object.isFrozen(countWindow(2).snapshot())).toBe(true);
  });
});

describe("time window", () => {
  /** A 1000ms window has 100 buckets of 10ms. */
  function timeWindow(size = 1_000): { time: ManualTime; window: SlidingWindow } {
    const time = createManualTime(START);
    return { time, window: createSlidingWindow({ type: "time", size }, time.clock) };
  }

  test("starts empty", () => {
    expect(timeWindow().window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("holds outcomes recorded across several buckets", async () => {
    const { time, window } = timeWindow();

    window.record(true);
    await time.advance(250);
    window.record(false);
    await time.advance(500);
    window.record(true);

    expect(window.snapshot()).toEqual({ buffered: 3, failed: 2 });
  });

  test("evicts a bucket exactly when the window moves a full size past its start", async () => {
    const { time, window } = timeWindow();
    window.record(true);

    await time.advance(999);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });

    await time.advance(1);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("an outcome late in a bucket is evicted with that bucket, at the next bucket boundary", async () => {
    const { time, window } = timeWindow();
    await time.advance(9);
    window.record(true);

    await time.advance(990);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });

    await time.advance(1);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("evicts only the buckets that fall out, across several boundaries at once", async () => {
    const { time, window } = timeWindow();
    window.record(true);
    await time.advance(100);
    window.record(false);
    await time.advance(100);
    window.record(true);

    await time.advance(950);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });
  });

  test("record evicts as well as snapshot", async () => {
    const { time, window } = timeWindow();
    window.record(true);

    await time.advance(1_000);
    window.record(false);

    expect(window.snapshot()).toEqual({ buffered: 1, failed: 0 });
  });

  test("a clock jump larger than the whole window empties it, and it keeps recording", async () => {
    const { time, window } = timeWindow();
    recordAll(window, [true, false, true]);

    await time.advance(50_000);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });

    window.record(true);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });
  });

  test("a clock stepping back lands in the newest bucket and evicts nothing", async () => {
    const time = createManualTime(START);
    let stepBack = 0;
    const window = createSlidingWindow({ type: "time", size: 1_000 }, () => time.clock() - stepBack);
    window.record(true);
    await time.advance(500);
    window.record(false);

    stepBack = 800;
    window.record(true);
    expect(window.snapshot()).toEqual({ buffered: 3, failed: 2 });

    stepBack = 0;
    await time.advance(999);
    expect(window.snapshot()).toEqual({ buffered: 2, failed: 1 });

    await time.advance(1);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("many records in one bucket are aggregated and evicted together", async () => {
    const { time, window } = timeWindow();
    for (let i = 0; i < 10_000; i += 1) {
      window.record(i % 4 === 0);
    }

    expect(window.snapshot()).toEqual({ buffered: 10_000, failed: 2_500 });

    await time.advance(1_000);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("a window under 100ms uses 1ms buckets", async () => {
    const { time, window } = timeWindow(5);
    window.record(true);
    await time.advance(4);
    window.record(false);

    await time.advance(1);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 0 });
  });

  test("a size that does not divide into buckets has an edge within one bucket of it", async () => {
    // 250ms gives 84 buckets of 3ms, spanning 252ms; the bucket holding t=1000 starts at t=999.
    const { time, window } = timeWindow(250);
    window.record(true);

    await time.advance(250);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 1 });

    await time.advance(1);
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });
  });

  test("clear empties every bucket and it keeps recording", async () => {
    const { time, window } = timeWindow();
    window.record(true);
    await time.advance(300);
    window.record(true);

    window.clear();
    expect(window.snapshot()).toEqual({ buffered: 0, failed: 0 });

    window.record(false);
    await time.advance(999);
    expect(window.snapshot()).toEqual({ buffered: 1, failed: 0 });
  });

  test("snapshots are frozen", () => {
    expect(Object.isFrozen(timeWindow().window.snapshot())).toBe(true);
  });
});
