import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import { type CircuitBreakerEvent, createCircuitBreaker } from "../circuit-breaker";
import { isOperationTimeoutError, isResilienceConfigError } from "../errors";
import { createRetry, fixedBackoff } from "../retry";
import { createTimeout } from "../timeout";
import type { ExecutionContext, Outcome } from "../types";
import { compose } from "./index";

const START = 1_000;

/** Lets an `execute` that registers its sleep after an await reach that registration. */
async function untilPending(time: ManualTime, count: number): Promise<void> {
  for (let i = 0; i < 50 && time.pendingSleeps !== count; i += 1) {
    await Promise.resolve();
  }
  expect(time.pendingSleeps).toBe(count);
}

/** Waits for one sleep to register, then moves time past it. */
async function step(time: ManualTime, ms: number): Promise<void> {
  await untilPending(time, 1);
  await time.advance(ms);
}

function retryOn(time: ManualTime, name: string, maxAttempts: number, shouldRetry?: (outcome: Outcome<unknown>) => boolean) {
  return createRetry(name, { maxAttempts, backoff: fixedBackoff(10), shouldRetry }, { clock: time.clock, scheduler: time.scheduler });
}

/** A breaker that opens on its first recorded failure and stays open for 1000ms. */
function breakerOn(time: ManualTime, name = "breaker", size = 1) {
  return createCircuitBreaker(
    name,
    {
      failureRateThreshold: 50,
      slidingWindow: { type: "count", size },
      minimumCalls: size,
      waitDurationInOpenMs: 1_000,
      permittedCallsInHalfOpen: 1,
    },
    { clock: time.clock },
  );
}

function timeoutOn(time: ManualTime, name = "timeout") {
  return createTimeout(name, { durationMs: 100 }, { clock: time.clock, scheduler: time.scheduler });
}

function errorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

describe("compose", () => {
  test("throws a ResilienceConfigError for zero policies", () => {
    expect(isResilienceConfigError(errorOf(() => compose()))).toBe(true);
  });

  test("joins the policies' names with ' > ', outermost first", () => {
    const time = createManualTime(START);
    const policy = compose(retryOn(time, "retry", 2), breakerOn(time), timeoutOn(time));

    expect(policy.name).toBe("retry > breaker > timeout");
  });

  test("wraps a single policy in a new policy named after it", async () => {
    const time = createManualTime(START);
    const breaker = breakerOn(time);
    const policy = compose(breaker);

    expect(policy).not.toBe(breaker);
    expect(policy.name).toBe("breaker");
    await expect(policy.execute(({ attempt }) => `attempt ${attempt}`)).resolves.toBe("attempt 1");
  });

  test("carries no events", () => {
    const time = createManualTime(START);
    const policy = compose(retryOn(time, "retry", 2), breakerOn(time));

    expect("events" in policy).toBe(false);
  });

  test("in retry > breaker the operation sees the retry's attempt", async () => {
    const time = createManualTime(START);
    const policy = compose(retryOn(time, "retry", 3), breakerOn(time, "breaker", 10));
    const attempts: number[] = [];

    const result = policy.execute(({ attempt }) => {
      attempts.push(attempt);
      if (attempt < 3) {
        throw new Error(`attempt ${attempt} failed`);
      }
      return "done";
    });
    await step(time, 10);
    await step(time, 10);

    await expect(result).resolves.toBe("done");
    expect(attempts).toEqual([1, 2, 3]);
  });

  test("under nested retries the attempt repeats where the outer retry's attempt passes through the inner's first", async () => {
    const time = createManualTime(START);
    const stop = new Error("not retried by the inner retry");
    const outer = retryOn(time, "outer", 2);
    const inner = retryOn(time, "inner", 3, (outcome) => !outcome.ok && outcome.error !== stop);
    const policy = compose(outer, inner);
    const script: Array<Outcome<string>> = [
      { ok: false, error: stop },
      { ok: false, error: new Error("retried") },
      { ok: false, error: new Error("retried") },
      { ok: true, value: "done" },
    ];
    const attempts: number[] = [];

    const result = policy.execute(({ attempt }) => {
      attempts.push(attempt);
      const outcome = script[attempts.length - 1] as Outcome<string>;
      if (!outcome.ok) {
        throw outcome.error;
      }
      return outcome.value;
    });
    await step(time, 10);
    await step(time, 10);
    await step(time, 10);

    await expect(result).resolves.toBe("done");
    expect(attempts).toEqual([1, 2, 2, 3]);
  });

  test("a caller abort reaches the innermost operation through the outermost policy", async () => {
    const time = createManualTime(START);
    const policy = compose(retryOn(time, "retry", 3), breakerOn(time), timeoutOn(time));
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    let seen: AbortSignal | undefined;

    const result = policy.execute(
      ({ signal }: ExecutionContext) =>
        new Promise<string>((_, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
      { signal: controller.signal },
    );
    await untilPending(time, 1);
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe(reason);
  });

  test("a timeout inside a breaker counts as a breaker failure", async () => {
    const time = createManualTime(START);
    const breaker = breakerOn(time);
    const policy = compose(breaker, timeoutOn(time));

    const failure = policy.execute(() => new Promise<string>(() => {})).catch((error: unknown) => error);
    await step(time, 100);

    expect(isOperationTimeoutError(await failure)).toBe(true);
    expect(breaker.state).toBe("open");
  });

  test("the breaker changes state synchronously within the composed execute call", async () => {
    const time = createManualTime(START);
    const breaker = breakerOn(time);
    const events: CircuitBreakerEvent[] = [];
    await expect(breaker.execute(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await time.advance(1_000);
    breaker.events.on((event) => events.push(event));
    const policy = compose(retryOn(time, "retry", 2), breaker);

    const result = policy.execute(() => "probe");

    expect(events.map((event) => event.kind === "circuit-state-changed" && event.to)).toEqual(["half-open"]);
    await expect(result).resolves.toBe("probe");
    expect(breaker.state).toBe("closed");
  });
});
