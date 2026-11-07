import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import { isRateLimitExceededError, type RateLimitExceededError } from "../errors";
import type { ExecutionContext } from "../types";
import { createRateLimiter, type RateLimiterConfig, type RateLimiterEvent, type RateLimiterPolicy } from "./index";

const START = 1_000;

function setup(config: Partial<RateLimiterConfig> = {}): { time: ManualTime; limiter: RateLimiterPolicy; events: RateLimiterEvent[] } {
  const time = createManualTime(START);
  const limiter = createRateLimiter(
    "api",
    { limitForPeriod: 1, refreshPeriodMs: 100, maxWaitMs: 1_000, ...config },
    { clock: time.clock, scheduler: time.scheduler },
  );
  const events: RateLimiterEvent[] = [];
  limiter.events.on((event) => events.push(event));
  return { time, limiter, events };
}

/** Lets an `execute` that registers its sleep after an await reach that registration. */
async function untilPending(time: ManualTime, count: number): Promise<void> {
  for (let i = 0; i < 50 && time.pendingSleeps !== count; i += 1) {
    await Promise.resolve();
  }
  expect(time.pendingSleeps).toBe(count);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** An op that records the clock reading it ran at under `label`. */
function recording(time: ManualTime, log: Array<[string, number]>, label: string): () => string {
  return () => {
    log.push([label, time.clock()]);
    return label;
  };
}

describe("createRateLimiter", () => {
  test("exposes its name", () => {
    expect(setup().limiter.name).toBe("api");
  });

  test("runs the system clock and scheduler when given no deps", async () => {
    const limiter = createRateLimiter("api", { limitForPeriod: 1, refreshPeriodMs: 60_000, maxWaitMs: 0 });

    await expect(limiter.execute(() => "ran")).resolves.toBe("ran");
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("a free permit runs the operation at once with attempt 1, emitting nothing", async () => {
    const { time, limiter, events } = setup({ limitForPeriod: 2 });
    const op = vi.fn((ctx: ExecutionContext) => Promise.resolve(ctx.attempt));

    await expect(limiter.execute(op)).resolves.toBe(1);
    await expect(limiter.execute(op)).resolves.toBe(1);
    expect(op).toHaveBeenCalledTimes(2);
    expect(op.mock.calls[0]?.[0].signal.aborted).toBe(false);
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test("passes the caller's signal to the operation", async () => {
    const { limiter } = setup();
    const controller = new AbortController();
    const op = vi.fn((ctx: ExecutionContext) => ctx.signal);

    await expect(limiter.execute(op, { signal: controller.signal })).resolves.toBe(controller.signal);
  });

  test("starts with limitForPeriod free permits, even when burst is higher", () => {
    const { limiter } = setup({ limitForPeriod: 2, burst: 5 });

    expect(limiter.tryAcquire(3)).toBe(false);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("refills limitForPeriod permits at each period boundary", async () => {
    const { time, limiter } = setup({ limitForPeriod: 2 });

    expect(limiter.tryAcquire(2)).toBe(true);
    await time.advance(99);
    expect(limiter.tryAcquire()).toBe(false);
    await time.advance(1);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("carries unused permits over, capped at burst", async () => {
    const { time, limiter } = setup({ limitForPeriod: 2, burst: 5 });

    await time.advance(100);
    expect(limiter.tryAcquire(4)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    await time.advance(1_000);
    expect(limiter.tryAcquire(5)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("without burst each period resets the free permits to limitForPeriod", async () => {
    const { time, limiter } = setup({ limitForPeriod: 2 });

    await time.advance(500);
    expect(limiter.tryAcquire(3)).toBe(false);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("a clock stepping back adds nothing, and stepping forward again refills each period once", () => {
    let now = START;
    const limiter = createRateLimiter("api", { limitForPeriod: 1, refreshPeriodMs: 100, maxWaitMs: 0 }, { clock: () => now });

    expect(limiter.tryAcquire()).toBe(true);
    now = START + 150;
    expect(limiter.tryAcquire()).toBe(true);
    now = START - 50;
    expect(limiter.tryAcquire()).toBe(false);
    now = START + 150;
    expect(limiter.tryAcquire()).toBe(false);
    now = START + 200;
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("waits for a permit due within maxWaitMs, then runs and emits rate-limit-waited", async () => {
    const { time, limiter, events } = setup({ maxWaitMs: 100 });
    const op = vi.fn(() => "late");
    await limiter.execute(() => "first");
    await time.advance(30);

    const result = limiter.execute(op);
    await untilPending(time, 1);
    await time.advance(69);
    expect(op).not.toHaveBeenCalled();
    await time.advance(1);

    await expect(result).resolves.toBe("late");
    expect(events).toEqual([{ kind: "rate-limit-waited", name: "api", at: START + 100, permits: 1, waitMs: 70 }]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("refuses at once when the permit is due beyond maxWaitMs, reserving nothing", async () => {
    const { time, limiter, events } = setup({ maxWaitMs: 50 });
    await limiter.execute(() => "first");
    const op = vi.fn();

    const error = (await rejectionOf(limiter.execute(op))) as RateLimitExceededError;

    expect(isRateLimitExceededError(error)).toBe(true);
    expect(error.message).toBe('Rate limiter "api" refused the call: its permit is free in 100ms, beyond the 50ms it may wait');
    expect(error).toMatchObject({ limiter: "api", permits: 1, retryAfterMs: 100 });
    expect(op).not.toHaveBeenCalled();
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([{ kind: "rate-limit-exceeded", name: "api", at: START, permits: 1, retryAfterMs: 100 }]);

    await time.advance(60);
    const next = limiter.execute(() => "next");
    await untilPending(time, 1);
    await time.advance(40);
    await expect(next).resolves.toBe("next");
    expect(events.at(-1)).toEqual({ kind: "rate-limit-waited", name: "api", at: START + 100, permits: 1, waitMs: 40 });
    expect(time.pendingSleeps).toBe(0);
  });

  test("maxWaitMs 0 refuses whenever no permit is free", async () => {
    const { time, limiter } = setup({ maxWaitMs: 0 });
    await limiter.execute(() => "first");
    await time.advance(25);

    const error = (await rejectionOf(limiter.execute(() => "never"))) as RateLimitExceededError;

    expect(error.retryAfterMs).toBe(75);
    expect(time.pendingSleeps).toBe(0);
    await time.advance(75);
    await expect(limiter.execute(() => "next")).resolves.toBe("next");
  });

  test("serves waiting calls in arrival order, one period apart", async () => {
    const { time, limiter, events } = setup();
    const log: Array<[string, number]> = [];
    await limiter.execute(recording(time, log, "a"));

    const waiting = ["b", "c", "d"].map((label) => limiter.execute(recording(time, log, label)));
    await untilPending(time, 3);
    await time.advance(300);

    await expect(Promise.all(waiting)).resolves.toEqual(["b", "c", "d"]);
    expect(log).toEqual([
      ["a", START],
      ["b", START + 100],
      ["c", START + 200],
      ["d", START + 300],
    ]);
    expect(events.map((event) => (event.kind === "rate-limit-waited" ? event.waitMs : undefined))).toEqual([100, 200, 300]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("tryAcquire cannot take permits a waiting call has reserved", async () => {
    const { time, limiter } = setup({ limitForPeriod: 2 });
    await limiter.execute(() => "a");
    await limiter.execute(() => "b");

    const waiting = limiter.execute(() => "c");
    await untilPending(time, 1);
    expect(limiter.tryAcquire()).toBe(false);
    await time.advance(100);
    await expect(waiting).resolves.toBe("c");
    expect(limiter.tryAcquire(2)).toBe(false);
    expect(limiter.tryAcquire()).toBe(true);
    expect(time.pendingSleeps).toBe(0);
  });

  test("an aborted waiter returns its permit to a later arrival; earlier sleepers keep their due instants", async () => {
    const { time, limiter, events } = setup();
    const log: Array<[string, number]> = [];
    await limiter.execute(recording(time, log, "a"));
    const b = limiter.execute(recording(time, log, "b"));
    const controller = new AbortController();
    const c = limiter.execute(recording(time, log, "c"), { signal: controller.signal });
    await untilPending(time, 2);

    const reason = new Error("caller gave up");
    controller.abort(reason);
    expect(await rejectionOf(c)).toBe(reason);
    expect(time.pendingSleeps).toBe(1);

    const d = limiter.execute(recording(time, log, "d"));
    await untilPending(time, 2);
    await time.advance(200);

    await expect(Promise.all([b, d])).resolves.toEqual(["b", "d"]);
    expect(log).toEqual([
      ["a", START],
      ["b", START + 100],
      ["d", START + 200],
    ]);
    expect(events).toEqual([
      { kind: "rate-limit-waited", name: "api", at: START + 100, permits: 1, waitMs: 100 },
      { kind: "rate-limit-waited", name: "api", at: START + 200, permits: 1, waitMs: 200 },
    ]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("a permit returned by an aborted waiter is capped at burst", async () => {
    let now = START;
    const time = createManualTime(START);
    const limiter = createRateLimiter(
      "api",
      { limitForPeriod: 1, refreshPeriodMs: 100, maxWaitMs: 1_000, burst: 2 },
      { clock: () => now, scheduler: time.scheduler },
    );
    await limiter.execute(() => "a");
    const controller = new AbortController();
    const waiting = limiter.execute(() => "b", { signal: controller.signal });
    await untilPending(time, 1);
    now = START + 500;
    expect(limiter.tryAcquire(3)).toBe(false);

    const reason = new Error("stop");
    controller.abort(reason);
    expect(await rejectionOf(waiting)).toBe(reason);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    expect(time.pendingSleeps).toBe(0);
  });

  test("a pre-aborted signal rejects with its reason before taking a permit", async () => {
    const { time, limiter, events } = setup();
    const reason = new Error("already gone");
    const op = vi.fn();

    expect(await rejectionOf(limiter.execute(op, { signal: AbortSignal.abort(reason) }))).toBe(reason);
    expect(op).not.toHaveBeenCalled();
    expect(limiter.tryAcquire()).toBe(true);
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test("an operation that throws synchronously rejects with its error and keeps its permit", async () => {
    const { limiter } = setup();
    const failure = new Error("sync");

    expect(
      await rejectionOf(
        limiter.execute(() => {
          throw failure;
        }),
      ),
    ).toBe(failure);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test.each([0, -1, 1.5, Number.NaN])("tryAcquire throws a RangeError for %s permits", (permits) => {
    const { limiter } = setup();

    expect(() => limiter.tryAcquire(permits)).toThrow(
      new RangeError(`Rate limiter "api" expects permits to be an integer of at least 1, got ${permits}`),
    );
  });

  test("tryAcquire refuses more permits than burst without emitting", () => {
    const { limiter, events } = setup({ limitForPeriod: 2, burst: 3 });

    expect(limiter.tryAcquire(4)).toBe(false);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    expect(events).toEqual([]);
  });

  test("a throwing listener breaks neither the limiter nor the listeners after it", async () => {
    const time = createManualTime(START);
    const limiter = createRateLimiter(
      "api",
      { limitForPeriod: 1, refreshPeriodMs: 100, maxWaitMs: 100 },
      { clock: time.clock, scheduler: time.scheduler },
    );
    const seen: string[] = [];
    limiter.events.on(() => {
      throw new Error("listener");
    });
    limiter.events.on((event) => seen.push(event.kind));
    await limiter.execute(() => "a");

    const b = limiter.execute(() => "b");
    await untilPending(time, 1);
    await time.advance(100);
    await expect(b).resolves.toBe("b");
    const c = limiter.execute(() => "c");
    expect(isRateLimitExceededError(await rejectionOf(limiter.execute(() => "d")))).toBe(true);
    await untilPending(time, 1);
    await time.advance(100);
    await expect(c).resolves.toBe("c");

    expect(seen).toEqual(["rate-limit-waited", "rate-limit-exceeded", "rate-limit-waited"]);
    expect(time.pendingSleeps).toBe(0);
  });
});
