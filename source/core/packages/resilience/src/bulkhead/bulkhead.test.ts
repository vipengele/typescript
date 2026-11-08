import type { Scheduler } from "@vipengele/ts-core-common";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import { type BulkheadFullError, isBulkheadFullError } from "../errors";
import type { ExecutionContext } from "../types";
import { type BulkheadConfig, type BulkheadEvent, type BulkheadPolicy, createBulkhead } from "./index";

const START = 1_000;

function setup(config: Partial<BulkheadConfig> = {}): { time: ManualTime; bulkhead: BulkheadPolicy; events: BulkheadEvent[] } {
  const time = createManualTime(START);
  const bulkhead = createBulkhead("db", { maxConcurrent: 1, ...config }, { clock: time.clock, scheduler: time.scheduler });
  const events: BulkheadEvent[] = [];
  bulkhead.events.on((event) => events.push(event));
  return { time, bulkhead, events };
}

interface Gate {
  readonly promise: Promise<string>;
  resolve(value: string): void;
  reject(error: unknown): void;
}

function gate(): Gate {
  let resolve: (value: string) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes microtasks until `condition` holds, so a handed-off permit reaches its waiter's op. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !condition(); i += 1) {
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** An op that logs `label` when it starts and settles with `held`. */
function holding(log: string[], label: string, held: Gate): () => Promise<string> {
  return () => {
    log.push(label);
    return held.promise;
  };
}

describe("createBulkhead", () => {
  test("exposes its name and starts with maxConcurrent permits available", () => {
    const { bulkhead } = setup({ maxConcurrent: 3 });

    expect(bulkhead.name).toBe("db");
    expect(bulkhead.available).toBe(3);
  });

  test("runs the system clock and scheduler when given no deps", async () => {
    const bulkhead = createBulkhead("db", { maxConcurrent: 1, maxQueue: 1, maxWaitMs: 60_000 });
    const held = gate();

    const first = bulkhead.execute(() => held.promise);
    const second = bulkhead.execute(() => "second");
    held.resolve("first");

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(bulkhead.available).toBe(1);
  });

  test("a free permit runs the operation at once with attempt 1 and a live signal, emitting nothing", async () => {
    const { time, bulkhead, events } = setup();
    const op = vi.fn((ctx: ExecutionContext) => ctx);

    const ctx = await bulkhead.execute(op);
    expect(ctx.attempt).toBe(1);
    expect(ctx.signal.aborted).toBe(false);
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test("passes the caller's signal to the operation", async () => {
    const { bulkhead } = setup();
    const controller = new AbortController();

    await expect(bulkhead.execute((ctx) => ctx.signal, { signal: controller.signal })).resolves.toBe(controller.signal);
  });

  test("available counts down as calls take permits and back up as they settle", async () => {
    const { bulkhead } = setup({ maxConcurrent: 2 });
    const a = gate();
    const b = gate();

    const first = bulkhead.execute(() => a.promise);
    expect(bulkhead.available).toBe(1);
    const second = bulkhead.execute(() => b.promise);
    expect(bulkhead.available).toBe(0);
    a.resolve("a");
    await first;
    expect(bulkhead.available).toBe(1);
    b.resolve("b");
    await second;
    expect(bulkhead.available).toBe(2);
  });

  test("with maxQueue 0 a call finding every permit taken is refused at once", async () => {
    const { bulkhead, events } = setup();
    const held = gate();
    const op = vi.fn(() => "never");

    const first = bulkhead.execute(() => held.promise);
    const error = (await rejectionOf(bulkhead.execute(op))) as BulkheadFullError;

    expect(isBulkheadFullError(error)).toBe(true);
    expect(error.bulkhead).toBe("db");
    expect(error.reason).toBe("full");
    expect(error.message).toBe('Bulkhead "db" refused the call: all 1 permits are taken and its queue of 0 is full');
    expect(op).not.toHaveBeenCalled();
    expect(events).toEqual([{ kind: "bulkhead-rejected", name: "db", at: START, reason: "full" }]);
    held.resolve("first");
    await first;
  });

  test("a call finding the queue full is refused at once, leaving the queue as it was", async () => {
    const { bulkhead, events } = setup({ maxConcurrent: 1, maxQueue: 1 });
    const held = gate();
    const log: string[] = [];

    const first = bulkhead.execute(holding(log, "first", held));
    const queued = bulkhead.execute(() => "queued");
    const error = (await rejectionOf(bulkhead.execute(() => "refused"))) as BulkheadFullError;

    expect(error.reason).toBe("full");
    expect(error.message).toBe('Bulkhead "db" refused the call: all 1 permits are taken and its queue of 1 is full');
    expect(events).toEqual([{ kind: "bulkhead-rejected", name: "db", at: START, reason: "full" }]);
    held.resolve("first");
    await expect(first).resolves.toBe("first");
    await expect(queued).resolves.toBe("queued");
    expect(bulkhead.available).toBe(1);
  });

  test("a queued call waiting past maxWaitMs leaves the queue and is refused with wait-timeout", async () => {
    const { time, bulkhead, events } = setup({ maxQueue: 1, maxWaitMs: 100 });
    const held = gate();
    const op = vi.fn(() => "late");

    const first = bulkhead.execute(() => held.promise);
    const queued = bulkhead.execute(op);
    const outcome = rejectionOf(queued);
    expect(time.pendingSleeps).toBe(1);
    await time.advance(99);
    expect(events).toEqual([]);
    await time.advance(1);

    const error = (await outcome) as BulkheadFullError;
    expect(isBulkheadFullError(error)).toBe(true);
    expect(error.reason).toBe("wait-timeout");
    expect(error.bulkhead).toBe("db");
    expect(error.message).toBe('Bulkhead "db" refused the call: no permit came free within the 100ms it may wait');
    expect(events).toEqual([{ kind: "bulkhead-rejected", name: "db", at: START + 100, reason: "wait-timeout" }]);
    expect(time.pendingSleeps).toBe(0);

    const next = bulkhead.execute(() => "next");
    expect(time.pendingSleeps).toBe(1);
    held.resolve("first");
    await first;
    await expect(next).resolves.toBe("next");
    expect(op).not.toHaveBeenCalled();
    expect(time.pendingSleeps).toBe(0);
    expect(bulkhead.available).toBe(1);
  });

  test("a queued call whose signal aborts leaves the queue with no sleep left behind, and the next waiter gets the permit", async () => {
    const { time, bulkhead, events } = setup({ maxQueue: 2, maxWaitMs: 1_000 });
    const held = gate();
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const aborted = vi.fn(() => "aborted");

    const first = bulkhead.execute(() => held.promise);
    const leaving = bulkhead.execute(aborted, { signal: controller.signal });
    const staying = bulkhead.execute(() => "staying");
    expect(time.pendingSleeps).toBe(2);

    controller.abort(reason);
    await expect(leaving).rejects.toBe(reason);
    expect(time.pendingSleeps).toBe(1);

    held.resolve("first");
    await first;
    await expect(staying).resolves.toBe("staying");
    expect(aborted).not.toHaveBeenCalled();
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
    expect(bulkhead.available).toBe(1);
  });

  test("a hand-off keeps the permit counted and cancels the receiver's pending wait sleep", async () => {
    const { time, bulkhead } = setup({ maxQueue: 1, maxWaitMs: 1_000 });
    const firstHeld = gate();
    const secondHeld = gate();
    const log: string[] = [];

    const first = bulkhead.execute(holding(log, "first", firstHeld));
    const second = bulkhead.execute(holding(log, "second", secondHeld));
    expect(time.pendingSleeps).toBe(1);

    firstHeld.resolve("first");
    await first;
    await until(() => log.length === 2);
    expect(time.pendingSleeps).toBe(0);
    expect(bulkhead.available).toBe(0);

    await time.advance(1_000);
    secondHeld.resolve("second");
    await expect(second).resolves.toBe("second");
    expect(bulkhead.available).toBe(1);
  });

  test("a wait sleep resolving after its waiter was granted the permit refuses nothing", async () => {
    const sleeps: Array<() => void> = [];
    const scheduler: Scheduler = {
      sleep: () =>
        new Promise<void>((resolve) => {
          sleeps.push(resolve);
        }),
    };
    const bulkhead = createBulkhead("db", { maxConcurrent: 1, maxQueue: 1, maxWaitMs: 100 }, { scheduler });
    const events: BulkheadEvent[] = [];
    bulkhead.events.on((event) => events.push(event));
    const firstHeld = gate();
    const secondHeld = gate();

    const first = bulkhead.execute(() => firstHeld.promise);
    const second = bulkhead.execute(() => secondHeld.promise);
    firstHeld.resolve("first");
    await first;
    sleeps[0]?.();
    await Promise.resolve();
    secondHeld.resolve("second");

    await expect(second).resolves.toBe("second");
    expect(events).toEqual([]);
    expect(bulkhead.available).toBe(1);
  });

  test("releases the permit when the operation throws synchronously, handing it to the next waiter", async () => {
    const { bulkhead } = setup({ maxQueue: 1 });
    const boom = new Error("boom");

    const failing = bulkhead.execute(() => {
      throw boom;
    });
    const queued = bulkhead.execute(() => "queued");

    await expect(failing).rejects.toBe(boom);
    await expect(queued).resolves.toBe("queued");
    expect(bulkhead.available).toBe(1);
  });

  test("releases the permit when the operation rejects", async () => {
    const { bulkhead } = setup();
    const boom = new Error("boom");

    await expect(bulkhead.execute(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(bulkhead.available).toBe(1);
  });

  test("releases the permit when the operation resolves", async () => {
    const { bulkhead } = setup();

    await expect(bulkhead.execute(() => Promise.resolve("done"))).resolves.toBe("done");
    expect(bulkhead.available).toBe(1);
  });

  test("an aborted running caller keeps its permit until its operation settles", async () => {
    const { bulkhead } = setup();
    const held = gate();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;

    const running = bulkhead.execute(
      (ctx) => {
        seen = ctx.signal;
        return held.promise;
      },
      { signal: controller.signal },
    );
    controller.abort(new Error("caller gave up"));

    expect(seen?.aborted).toBe(true);
    expect(bulkhead.available).toBe(0);
    const refused = (await rejectionOf(bulkhead.execute(() => "refused"))) as BulkheadFullError;
    expect(refused.reason).toBe("full");

    held.resolve("settled anyway");
    await expect(running).resolves.toBe("settled anyway");
    expect(bulkhead.available).toBe(1);
  });

  test("hands released permits to queued callers oldest first", async () => {
    const { bulkhead } = setup({ maxQueue: 3 });
    const log: string[] = [];
    const gates = [gate(), gate(), gate(), gate()];
    const [a, b, c, d] = gates as [Gate, Gate, Gate, Gate];

    const results = [
      bulkhead.execute(holding(log, "a", a)),
      bulkhead.execute(holding(log, "b", b)),
      bulkhead.execute(holding(log, "c", c)),
      bulkhead.execute(holding(log, "d", d)),
    ];
    expect(log).toEqual(["a"]);

    a.resolve("a");
    await until(() => log.length === 2);
    expect(log).toEqual(["a", "b"]);
    b.resolve("b");
    await until(() => log.length === 3);
    expect(log).toEqual(["a", "b", "c"]);
    c.resolve("c");
    await until(() => log.length === 4);
    expect(log).toEqual(["a", "b", "c", "d"]);
    expect(bulkhead.available).toBe(0);
    d.resolve("d");

    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c", "d"]);
    expect(bulkhead.available).toBe(1);
  });

  test("without maxWaitMs a queued caller waits with no sleep until it gets a permit", async () => {
    const { time, bulkhead, events } = setup({ maxQueue: 1 });
    const held = gate();
    const op = vi.fn(() => "waited");

    const first = bulkhead.execute(() => held.promise);
    const queued = bulkhead.execute(op);
    expect(time.pendingSleeps).toBe(0);
    await time.advance(1_000_000);
    expect(op).not.toHaveBeenCalled();

    held.resolve("first");
    await first;
    await expect(queued).resolves.toBe("waited");
    expect(events).toEqual([]);
  });

  test("without maxWaitMs a queued caller waits until its signal aborts", async () => {
    const { time, bulkhead } = setup({ maxQueue: 1 });
    const held = gate();
    const controller = new AbortController();
    const reason = new Error("caller gave up");

    const first = bulkhead.execute(() => held.promise);
    const queued = bulkhead.execute(() => "never", { signal: controller.signal });
    await time.advance(1_000_000);
    controller.abort(reason);

    await expect(queued).rejects.toBe(reason);
    expect(bulkhead.available).toBe(0);
    held.resolve("first");
    await first;
    expect(bulkhead.available).toBe(1);
  });

  test("a pre-aborted signal rejects with its reason before taking a permit or a queue place", async () => {
    const { bulkhead, events } = setup();
    const controller = new AbortController();
    const reason = new Error("already aborted");
    controller.abort(reason);
    const op = vi.fn(() => "never");

    await expect(bulkhead.execute(op, { signal: controller.signal })).rejects.toBe(reason);
    expect(op).not.toHaveBeenCalled();
    expect(bulkhead.available).toBe(1);
    expect(events).toEqual([]);
  });

  test("a throwing listener breaks neither the bulkhead nor the listeners after it", async () => {
    const { bulkhead } = setup();
    const after = vi.fn();
    bulkhead.events.on(() => {
      throw new Error("listener failed");
    });
    bulkhead.events.on(after);
    const held = gate();

    const first = bulkhead.execute(() => held.promise);
    const refused = (await rejectionOf(bulkhead.execute(() => "refused"))) as BulkheadFullError;

    expect(refused.reason).toBe("full");
    expect(after).toHaveBeenCalledTimes(1);
    held.resolve("first");
    await expect(first).resolves.toBe("first");
    expect(bulkhead.available).toBe(1);
  });
});
