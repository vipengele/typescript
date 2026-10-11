import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import {
  BulkheadFullError,
  CircuitOpenError,
  isResilienceConfigError,
  OperationTimeoutError,
  RateLimitExceededError,
  ResilienceConfigError,
} from "../errors";
import type { ExecutionContext, Outcome } from "../types";
import { createRetry, exponentialBackoff, fixedBackoff, type RetryConfig, type RetryEvent, withJitter } from "./index";

const START = 1_000;
const MAX_DELAY_MS = 2_147_483_647;

function setup(config: Partial<RetryConfig> = {}): { time: ManualTime; policy: ReturnType<typeof createRetry>; events: RetryEvent[] } {
  const time = createManualTime(START);
  const policy = createRetry(
    "fetch-user",
    { maxAttempts: 3, backoff: fixedBackoff(100), ...config },
    { clock: time.clock, scheduler: time.scheduler },
  );
  const events: RetryEvent[] = [];
  policy.events.on((event) => events.push(event));
  return { time, policy, events };
}

/** Lets an `execute` that registers its sleep after an await reach that registration. */
async function untilPending(time: ManualTime, count: number): Promise<void> {
  for (let i = 0; i < 50 && time.pendingSleeps !== count; i += 1) {
    await Promise.resolve();
  }
  expect(time.pendingSleeps).toBe(count);
}

/** Waits for the backoff sleep to register, then moves time past it. */
async function step(time: ManualTime, ms: number): Promise<void> {
  await untilPending(time, 1);
  await time.advance(ms);
}

function delaysOf(events: RetryEvent[]): number[] {
  return events.flatMap((event) => (event.kind === "retry" ? [event.delayMs] : []));
}

/** An op that throws `failures` errors in turn and then returns `value`. */
function failingTimes<T>(failures: unknown[], value: T): (ctx: ExecutionContext) => Promise<T> {
  return async ({ attempt }) => {
    if (attempt <= failures.length) {
      throw failures[attempt - 1];
    }
    return value;
  };
}

function errorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

describe("createRetry", () => {
  test("exposes its name", () => {
    expect(setup().policy.name).toBe("fetch-user");
  });

  test("a first-attempt success resolves without sleeping or emitting", async () => {
    const { time, policy, events } = setup();
    const op = vi.fn((ctx: ExecutionContext) => Promise.resolve(`attempt ${ctx.attempt}`));

    await expect(policy.execute(op)).resolves.toBe("attempt 1");
    expect(op).toHaveBeenCalledOnce();
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test("a synchronous return value resolves", async () => {
    const { policy } = setup();

    await expect(policy.execute(() => 42)).resolves.toBe(42);
  });

  test("retries a failure after the backoff, numbering attempts from 1", async () => {
    const { time, policy } = setup();
    const op = vi.fn(failingTimes([new Error("a"), new Error("b")], "user"));
    const result = policy.execute(op);

    await step(time, 99);
    expect(op).toHaveBeenCalledTimes(1);
    await time.advance(1);
    expect(op).toHaveBeenCalledTimes(2);
    await step(time, 100);

    await expect(result).resolves.toBe("user");
    expect(op.mock.calls.map(([ctx]) => ctx.attempt)).toEqual([1, 2, 3]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("a synchronous throw counts as a failed attempt", async () => {
    const { time, policy } = setup();
    const op = vi.fn(({ attempt }: ExecutionContext) => {
      if (attempt === 1) {
        throw new Error("sync");
      }
      return "recovered";
    });
    const result = policy.execute(op);

    await step(time, 100);

    await expect(result).resolves.toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });

  test("rethrows the last error as the same object once maxAttempts is used", async () => {
    const { time, policy } = setup();
    const errors = [new Error("1"), new Error("2"), new Error("3")];
    const op = vi.fn(failingTimes(errors, "never"));
    const settled = policy.execute(op).catch((error: unknown) => error);

    await step(time, 100);
    await step(time, 100);

    expect(await settled).toBe(errors[2]);
    expect(op).toHaveBeenCalledTimes(3);
    expect(time.pendingSleeps).toBe(0);
  });

  test("maxAttempts 1 runs once and never sleeps", async () => {
    const { time, policy } = setup({ maxAttempts: 1 });
    const failure = new Error("once");
    const op = vi.fn(() => Promise.reject(failure));

    await expect(policy.execute(op)).rejects.toBe(failure);
    expect(op).toHaveBeenCalledOnce();
    expect(time.pendingSleeps).toBe(0);
  });

  test("waits the exponential backoff between attempts", async () => {
    const { time, policy, events } = setup({ maxAttempts: 4, backoff: exponentialBackoff({ initialMs: 100 }) });
    const op = vi.fn(failingTimes([new Error("a"), new Error("b"), new Error("c")], "ok"));
    const result = policy.execute(op);

    await step(time, 100);
    await step(time, 199);
    expect(op).toHaveBeenCalledTimes(2);
    await time.advance(1);
    await step(time, 400);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([100, 200, 400]);
  });
});

describe("jitter", () => {
  test('"full" jitter scales each delay by the injected draw', async () => {
    const draws = [0.5, 0.25];
    const { time, policy, events } = setup({ backoff: withJitter(fixedBackoff(400), "full", () => draws.shift() ?? 0) });
    const result = policy.execute(failingTimes([new Error("a"), new Error("b")], "ok"));

    await step(time, 200);
    await step(time, 100);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([200, 100]);
  });

  test('"equal" jitter keeps half of each delay', async () => {
    const draws = [0, 0.5];
    const { time, policy, events } = setup({ backoff: withJitter(fixedBackoff(400), "equal", () => draws.shift() ?? 0) });
    const result = policy.execute(failingTimes([new Error("a"), new Error("b")], "ok"));

    await step(time, 200);
    await step(time, 300);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([200, 300]);
  });
});

describe("retryAfter", () => {
  test("overrides the backoff and sees the outcome and attempt", async () => {
    const failure = new Error("throttled");
    const retryAfter = vi.fn(() => 750);
    const { time, policy, events } = setup({ retryAfter });
    const result = policy.execute(failingTimes([failure], "ok"));

    await step(time, 749);
    expect(time.pendingSleeps).toBe(1);
    await time.advance(1);

    await expect(result).resolves.toBe("ok");
    expect(retryAfter).toHaveBeenCalledWith({ ok: false, error: failure }, 1);
    expect(delaysOf(events)).toEqual([750]);
  });

  test("undefined falls back to the backoff", async () => {
    const { time, policy, events } = setup({ retryAfter: (_, attempt) => (attempt === 1 ? undefined : 5) });
    const result = policy.execute(failingTimes([new Error("a"), new Error("b")], "ok"));

    await step(time, 100);
    await step(time, 5);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([100, 5]);
  });
});

describe("delay sanitising", () => {
  test.each([
    { requested: Number.NaN, slept: 0 },
    { requested: -50, slept: 0 },
    { requested: Number.NEGATIVE_INFINITY, slept: 0 },
    { requested: MAX_DELAY_MS + 1, slept: MAX_DELAY_MS },
    { requested: Number.POSITIVE_INFINITY, slept: MAX_DELAY_MS },
    { requested: MAX_DELAY_MS, slept: MAX_DELAY_MS },
  ])("a retryAfter of $requested waits $slept", async ({ requested, slept }) => {
    const { time, policy, events } = setup({ maxAttempts: 2, retryAfter: () => requested });
    const result = policy.execute(failingTimes([new Error("a")], "ok"));

    await step(time, slept);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([slept]);
  });

  test("an infinite backoff waits the maximum instead of failing the sleep", async () => {
    const failure = new Error("a");
    const { time, policy, events } = setup({ maxAttempts: 2, backoff: () => Number.POSITIVE_INFINITY });
    const result = policy.execute(failingTimes([failure], "ok"));

    await step(time, MAX_DELAY_MS - 1);
    expect(time.pendingSleeps).toBe(1);
    await time.advance(1);

    await expect(result).resolves.toBe("ok");
    expect(delaysOf(events)).toEqual([MAX_DELAY_MS]);
  });
});

describe("the default shouldRetry", () => {
  test.each([
    { name: "CircuitOpenError", error: new CircuitOpenError("open") },
    { name: "RateLimitExceededError", error: new RateLimitExceededError("limited") },
    { name: "BulkheadFullError", error: new BulkheadFullError("full") },
  ])("does not retry a $name, and emits nothing", async ({ error }) => {
    const { time, policy, events } = setup();
    const op = vi.fn(() => Promise.reject(error));

    await expect(policy.execute(op)).rejects.toBe(error);
    expect(op).toHaveBeenCalledOnce();
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test.each([
    { name: "an OperationTimeoutError", error: new OperationTimeoutError("slow", 10) },
    { name: "a plain Error", error: new Error("down") },
    { name: "a ResilienceConfigError", error: new ResilienceConfigError("bad") },
    { name: "a thrown non-error", error: "string failure" },
  ])("retries $name", async ({ error }) => {
    const { time, policy } = setup();
    const op = vi.fn(failingTimes([error], "ok"));
    const result = policy.execute(op);

    await step(time, 100);

    await expect(result).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  test("does not retry an ok outcome", async () => {
    const { policy, events } = setup();
    const op = vi.fn(() => "fine");

    await expect(policy.execute(op)).resolves.toBe("fine");
    expect(op).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });
});

describe("a custom shouldRetry", () => {
  test("can retry an ok outcome, and the last value is returned when attempts run out", async () => {
    const shouldRetry = vi.fn((outcome: Outcome<unknown>, _attempt: number) => outcome.ok && outcome.value !== "ready");
    const { time, policy, events } = setup({ shouldRetry });
    const op = vi.fn(({ attempt }: ExecutionContext) => `pending ${attempt}`);
    const result = policy.execute(op);

    await step(time, 100);
    await step(time, 100);

    await expect(result).resolves.toBe("pending 3");
    expect(op).toHaveBeenCalledTimes(3);
    expect(shouldRetry.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.kind)).toEqual(["retry", "retry", "retry-exhausted"]);
    expect(events[2]).toEqual({
      kind: "retry-exhausted",
      name: "fetch-user",
      at: START + 200,
      attempts: 3,
      outcome: { ok: true, value: "pending 3" },
    });
  });

  test("an ok outcome it declines resolves straight away", async () => {
    const { time, policy } = setup({ shouldRetry: (outcome) => outcome.ok && outcome.value !== "ready" });
    const result = policy.execute(({ attempt }) => (attempt === 2 ? "ready" : "pending"));

    await step(time, 100);

    await expect(result).resolves.toBe("ready");
  });

  test("declining an error stops at once and emits nothing", async () => {
    const failure = new Error("fatal");
    const shouldRetry = vi.fn(() => false);
    const { time, policy, events } = setup({ shouldRetry });

    await expect(policy.execute(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(shouldRetry).toHaveBeenCalledWith({ ok: false, error: failure }, 1);
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });
});

describe("the caller's signal", () => {
  test("is handed to every attempt", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const result = policy.execute(
      ({ signal, attempt }) => {
        seen.push(signal);
        return attempt === 1 ? Promise.reject(new Error("a")) : "ok";
      },
      { signal: controller.signal },
    );

    await step(time, 100);

    await expect(result).resolves.toBe("ok");
    expect(seen).toEqual([controller.signal, controller.signal]);
  });

  test("without one, the op receives a signal that is never aborted", async () => {
    const { policy } = setup();

    await expect(policy.execute(({ signal }) => signal.aborted)).resolves.toBe(false);
  });

  test("aborted before the first attempt rejects with its reason without calling op", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const op = vi.fn(() => "never");

    await expect(policy.execute(op, { signal: controller.signal })).rejects.toBe(reason);
    expect(op).not.toHaveBeenCalled();
    expect(time.pendingSleeps).toBe(0);
  });

  test("aborted during an attempt that then fails rejects with the reason, not the op's error, and never sleeps", async () => {
    const { time, policy, events } = setup();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const op = vi.fn(() => {
      controller.abort(reason);
      return Promise.reject(new Error("op failure"));
    });

    await expect(policy.execute(op, { signal: controller.signal })).rejects.toBe(reason);
    expect(op).toHaveBeenCalledOnce();
    expect(time.pendingSleeps).toBe(0);
    expect(events).toEqual([]);
  });

  test("aborted during an attempt that then succeeds still returns the value", async () => {
    const { policy } = setup();
    const controller = new AbortController();

    await expect(
      policy.execute(
        () => {
          controller.abort(new Error("cancelled"));
          return "done";
        },
        { signal: controller.signal },
      ),
    ).resolves.toBe("done");
  });

  test("aborted during the backoff sleep rejects with its reason and runs no further attempt", async () => {
    const { time, policy } = setup();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const op = vi.fn(() => Promise.reject(new Error("down")));
    const settled = policy.execute(op, { signal: controller.signal }).catch((error: unknown) => error);
    await untilPending(time, 1);

    controller.abort(reason);

    expect(await settled).toBe(reason);
    expect(time.pendingSleeps).toBe(0);
    await time.advance(100);
    expect(op).toHaveBeenCalledOnce();
  });
});

describe("events", () => {
  test("a retry event precedes each backoff sleep, carrying the sanitised delay and outcome", async () => {
    const { time, policy, events } = setup();
    const failure = new Error("a");
    const result = policy.execute(failingTimes([failure], "ok"));
    await untilPending(time, 1);

    expect(events).toEqual([
      { kind: "retry", name: "fetch-user", at: START, attempt: 1, delayMs: 100, outcome: { ok: false, error: failure } },
    ]);
    await time.advance(100);
    await expect(result).resolves.toBe("ok");
    expect(events).toHaveLength(1);
  });

  test("retry-exhausted follows the last retry when attempts run out", async () => {
    const { time, policy, events } = setup({ maxAttempts: 2 });
    const errors = [new Error("1"), new Error("2")];
    const settled = policy.execute(failingTimes(errors, "never")).catch(() => {});

    await step(time, 100);
    await settled;

    expect(events).toEqual([
      { kind: "retry", name: "fetch-user", at: START, attempt: 1, delayMs: 100, outcome: { ok: false, error: errors[0] } },
      { kind: "retry-exhausted", name: "fetch-user", at: START + 100, attempts: 2, outcome: { ok: false, error: errors[1] } },
    ]);
  });

  test("a throwing listener changes neither the retries nor the result", async () => {
    const { time, policy } = setup();
    policy.events.on(() => {
      throw new Error("listener");
    });
    const result = policy.execute(failingTimes([new Error("a")], "ok"));

    await step(time, 100);

    await expect(result).resolves.toBe("ok");
  });

  test("each policy has its own events", async () => {
    const { time, policy } = setup();
    const other = setup();
    const result = policy.execute(failingTimes([new Error("a")], "ok"));

    await step(time, 100);
    await result;

    expect(other.events).toEqual([]);
  });
});

describe("configuration", () => {
  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects maxAttempts %s with a ResilienceConfigError", (maxAttempts) => {
    expect(isResilienceConfigError(errorOf(() => createRetry("r", { maxAttempts, backoff: fixedBackoff(1) })))).toBe(true);
  });

  test("rejects an empty name with a ResilienceConfigError", () => {
    expect(isResilienceConfigError(errorOf(() => createRetry("", { maxAttempts: 1, backoff: fixedBackoff(1) })))).toBe(true);
  });

  test("accepts maxAttempts 1", () => {
    expect(() => createRetry("r", { maxAttempts: 1, backoff: fixedBackoff(1) })).not.toThrow();
  });
});

describe("default dependencies", () => {
  test("run against the system scheduler and clock", async () => {
    const policy = createRetry("system", { maxAttempts: 2, backoff: fixedBackoff(1) });
    const events: RetryEvent[] = [];
    policy.events.on((event) => events.push(event));
    const before = performance.timeOrigin + performance.now();

    await expect(policy.execute(failingTimes([new Error("a")], "ok"))).resolves.toBe("ok");

    expect(events).toHaveLength(1);
    expect(events[0]?.at).toBeGreaterThanOrEqual(before);
  });
});
