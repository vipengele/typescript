import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import { isOperationTimeoutError, isResilienceConfigError, OperationTimeoutError } from "../errors";
import type { ExecutionContext } from "../types";
import { createTimeout, MAX_TIMEOUT_DURATION_MS, type TimeoutEvent } from "./index";

const START = 1_000;

function setup(durationMs = 100): { time: ManualTime; policy: ReturnType<typeof createTimeout> } {
  const time = createManualTime(START);
  const policy = createTimeout("fetch-user", { durationMs }, { clock: time.clock, scheduler: time.scheduler });
  return { time, policy };
}

/** Lets an `execute` that registers its sleep after an await reach that registration. */
async function untilPending(time: ManualTime, count: number): Promise<void> {
  for (let i = 0; i < 50 && time.pendingSleeps !== count; i += 1) {
    await Promise.resolve();
  }
  expect(time.pendingSleeps).toBe(count);
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("createTimeout", () => {
  test("exposes its name", () => {
    expect(setup().policy.name).toBe("fetch-user");
  });

  test("a resolving op wins, and no sleep outlives it", async () => {
    const { time, policy } = setup();

    await expect(policy.execute(async () => "user")).resolves.toBe("user");
    expect(time.pendingSleeps).toBe(0);
  });

  test("an op that settles before the deadline wins after time has moved", async () => {
    const { time, policy } = setup();
    let finish: (value: string) => void = () => {};
    const result = policy.execute(() => new Promise<string>((resolve) => (finish = resolve)));
    await untilPending(time, 1);

    await time.advance(99);
    finish("late but in time");

    await expect(result).resolves.toBe("late but in time");
    expect(time.pendingSleeps).toBe(0);
  });

  test("a synchronous return value resolves", async () => {
    const { time, policy } = setup();

    await expect(policy.execute(() => 42)).resolves.toBe(42);
    expect(time.pendingSleeps).toBe(0);
  });

  test("a rejecting op rejects with its error, and no sleep outlives it", async () => {
    const { time, policy } = setup();
    const failure = new Error("down");

    await expect(policy.execute(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(time.pendingSleeps).toBe(0);
  });

  test("a synchronous throw rejects with the thrown value, and starts no sleep", async () => {
    const { time, policy } = setup();
    const failure = new Error("sync");

    await expect(
      policy.execute(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(time.pendingSleeps).toBe(0);
  });

  test("runs the op as attempt 1", async () => {
    const { policy } = setup();
    const op = vi.fn((ctx: ExecutionContext) => ctx.attempt);

    await expect(policy.execute(op)).resolves.toBe(1);
    expect(op).toHaveBeenCalledOnce();
  });

  test("the op's signal stays unaborted when the op wins", async () => {
    const { policy } = setup();
    let seen: AbortSignal | undefined;

    await policy.execute(({ signal }) => {
      seen = signal;
      return "ok";
    });

    expect(seen?.aborted).toBe(false);
  });
});

describe("when the timer wins", () => {
  test("rejects with an OperationTimeoutError carrying the duration", async () => {
    const { time, policy } = setup(250);
    const result = policy.execute(() => never());
    const settled = result.catch((error: unknown) => error);
    await untilPending(time, 1);

    await time.advance(250);

    const error = await settled;
    expect(isOperationTimeoutError(error)).toBe(true);
    expect((error as OperationTimeoutError).durationMs).toBe(250);
    expect((error as OperationTimeoutError).message).toContain("fetch-user");
    expect(time.pendingSleeps).toBe(0);
  });

  test("aborts the op's signal with the same error it rejects with", async () => {
    const { time, policy } = setup();
    let seen: AbortSignal | undefined;
    const result = policy.execute(({ signal }) => {
      seen = signal;
      return never();
    });
    const settled = result.catch((error: unknown) => error);
    await untilPending(time, 1);

    expect(seen?.aborted).toBe(false);
    await time.advance(100);

    const error = await settled;
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe(error);
    expect(error).toBeInstanceOf(OperationTimeoutError);
  });

  test("does not fire before the deadline", async () => {
    const { time, policy } = setup();
    const settled = vi.fn();
    policy.execute(() => never()).catch(settled);
    await untilPending(time, 1);

    await time.advance(99);

    expect(settled).not.toHaveBeenCalled();
    await time.advance(1);
    expect(settled).toHaveBeenCalledOnce();
  });

  test("emits a timeout event stamped with the clock", async () => {
    const { time, policy } = setup();
    const events: TimeoutEvent[] = [];
    policy.events.on((event) => events.push(event));
    const settled = policy.execute(() => never()).catch(() => {});
    await untilPending(time, 1);

    await time.advance(100);
    await settled;

    expect(events).toEqual([{ kind: "timeout", name: "fetch-user", at: START + 100, durationMs: 100 }]);
  });

  test("an abandoned op that rejects afterwards is not reported as unhandled", async () => {
    const { time, policy } = setup();
    let fail: (error: Error) => void = () => {};
    const settled = policy
      .execute(
        ({ signal }) =>
          new Promise<never>((_, reject) => {
            fail = reject;
            signal.addEventListener("abort", () => reject(signal.reason));
          }),
      )
      .catch((error: unknown) => error);
    await untilPending(time, 1);

    await time.advance(100);
    expect(isOperationTimeoutError(await settled)).toBe(true);

    fail(new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("an abandoned op that rejects without honouring its signal is not reported as unhandled", async () => {
    const { time, policy } = setup();
    let fail: (error: Error) => void = () => {};
    const settled = policy
      .execute(
        () =>
          new Promise<never>((_, reject) => {
            fail = reject;
          }),
      )
      .catch((error: unknown) => error);
    await untilPending(time, 1);

    await time.advance(100);
    expect(isOperationTimeoutError(await settled)).toBe(true);

    fail(new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("an abandoned op that resolves afterwards does not change the outcome", async () => {
    const { time, policy } = setup();
    let finish: (value: string) => void = () => {};
    const settled = policy.execute(() => new Promise<string>((resolve) => (finish = resolve))).catch((error: unknown) => error);
    await untilPending(time, 1);

    await time.advance(100);
    finish("too late");

    expect(isOperationTimeoutError(await settled)).toBe(true);
  });
});

describe("the caller's signal", () => {
  test("an already-aborted signal rejects with its reason without calling op or sleeping", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const op = vi.fn(() => "never");

    await expect(policy.execute(op, { signal: controller.signal })).rejects.toBe(reason);
    expect(op).not.toHaveBeenCalled();
    expect(time.pendingSleeps).toBe(0);
  });

  test("an abort mid-flight reaches the op's signal with the caller's reason", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    let seen: AbortSignal | undefined;
    const result = policy.execute(
      ({ signal }) => {
        seen = signal;
        return new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      },
      { signal: controller.signal },
    );
    await untilPending(time, 1);

    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(seen?.reason).toBe(reason);
    expect(time.pendingSleeps).toBe(0);
  });

  test("an abort mid-flight is not raced: an op that ignores it still runs to its own outcome", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    let finish: (value: string) => void = () => {};
    const result = policy.execute(() => new Promise<string>((resolve) => (finish = resolve)), {
      signal: controller.signal,
    });
    await untilPending(time, 1);

    controller.abort(new Error("cancelled"));
    finish("done anyway");

    await expect(result).resolves.toBe("done anyway");
  });

  test("an unaborted caller signal leaves a winning op untouched", async () => {
    const { policy } = setup();
    const controller = new AbortController();

    await expect(policy.execute(({ signal }) => signal.aborted, { signal: controller.signal })).resolves.toBe(false);
  });
});

describe("events", () => {
  async function timeOutOnce(time: ManualTime, policy: ReturnType<typeof createTimeout>): Promise<void> {
    const settled = policy.execute(() => never()).catch(() => {});
    await untilPending(time, 1);
    await time.advance(100);
    await settled;
  }

  test("an unsubscribed listener receives nothing further, and unsubscribing twice is harmless", async () => {
    const { time, policy } = setup();
    const kept = vi.fn();
    const dropped = vi.fn();
    policy.events.on(kept);
    const off = policy.events.on(dropped);

    await timeOutOnce(time, policy);
    off();
    off();
    await timeOutOnce(time, policy);

    expect(kept).toHaveBeenCalledTimes(2);
    expect(dropped).toHaveBeenCalledOnce();
  });

  test("a throwing listener does not change the rejection", async () => {
    const { time, policy } = setup();
    policy.events.on(() => {
      throw new Error("listener");
    });
    const settled = policy.execute(() => never()).catch((error: unknown) => error);
    await untilPending(time, 1);

    await time.advance(100);

    expect(isOperationTimeoutError(await settled)).toBe(true);
  });

  test("nothing is emitted when the op wins", async () => {
    const { policy } = setup();
    const listener = vi.fn();
    policy.events.on(listener);

    await policy.execute(() => "ok");

    expect(listener).not.toHaveBeenCalled();
  });

  test("each policy has its own events", async () => {
    const { time, policy } = setup();
    const other = setup().policy;
    const listener = vi.fn();
    other.events.on(listener);

    await timeOutOnce(time, policy);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects durationMs %s with a ResilienceConfigError",
    (durationMs) => {
      expect(() => createTimeout("t", { durationMs })).toThrow(expect.objectContaining({ code: "resilience.config" }));
    },
  );

  test("rejects a durationMs above the setTimeout maximum, which would otherwise fire almost at once", () => {
    let error: unknown;
    try {
      createTimeout("t", { durationMs: MAX_TIMEOUT_DURATION_MS + 1 });
    } catch (caught) {
      error = caught;
    }
    expect(isResilienceConfigError(error)).toBe(true);
  });

  test("accepts the setTimeout maximum and a fractional duration", () => {
    expect(() => createTimeout("t", { durationMs: MAX_TIMEOUT_DURATION_MS })).not.toThrow();
    expect(() => createTimeout("t", { durationMs: 0.5 })).not.toThrow();
  });

  test("rejects an empty name with a ResilienceConfigError", () => {
    let error: unknown;
    try {
      createTimeout("", { durationMs: 10 });
    } catch (caught) {
      error = caught;
    }
    expect(isResilienceConfigError(error)).toBe(true);
  });
});

describe("default dependencies", () => {
  test("run against the system scheduler and clock", async () => {
    const policy = createTimeout("system", { durationMs: 1 });
    const events: TimeoutEvent[] = [];
    policy.events.on((event) => events.push(event));
    const before = performance.timeOrigin + performance.now();

    await expect(policy.execute(() => "fast")).resolves.toBe("fast");
    await expect(policy.execute(() => never())).rejects.toBeInstanceOf(OperationTimeoutError);

    expect(events).toHaveLength(1);
    expect(events[0]?.at).toBeGreaterThanOrEqual(before);
  });
});
