import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test, vi } from "vitest";
import { BulkheadFullError, CircuitOpenError, isCircuitOpenError, isResilienceConfigError, RateLimitExceededError } from "../errors";
import type { Outcome } from "../types";
import {
  type CircuitBreakerConfig,
  type CircuitBreakerEvent,
  type CircuitBreakerPolicy,
  type CircuitStateChangedEvent,
  createCircuitBreaker,
} from "./circuit-breaker";

const START = 1_000;
const WAIT_MS = 1_000;

interface Harness {
  readonly time: ManualTime;
  readonly breaker: CircuitBreakerPolicy;
  readonly events: CircuitBreakerEvent[];
}

/** Opens at 50% over a count window of 4 once 4 calls are buffered, and half-opens with 2 probes. */
function setup(config: Partial<CircuitBreakerConfig> = {}, stepBack: () => number = () => 0): Harness {
  const time = createManualTime(START);
  const breaker = createCircuitBreaker(
    "payments",
    {
      failureRateThreshold: 50,
      slidingWindow: { type: "count", size: 4 },
      minimumCalls: 4,
      waitDurationInOpenMs: WAIT_MS,
      permittedCallsInHalfOpen: 2,
      ...config,
    },
    { clock: () => time.clock() - stepBack() },
  );
  const events: CircuitBreakerEvent[] = [];
  breaker.events.on((event) => events.push(event));
  return { time, breaker, events };
}

interface Deferred {
  readonly op: () => Promise<string>;
  resolve(value: string): void;
  reject(error: unknown): void;
}

/** An operation that stays in flight until the test settles it. */
function deferred(): Deferred {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { op: () => promise, resolve, reject };
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

async function succeed(breaker: CircuitBreakerPolicy): Promise<void> {
  await breaker.execute(() => "ok");
}

async function fail(breaker: CircuitBreakerPolicy): Promise<void> {
  await rejectionOf(breaker.execute(() => Promise.reject(new Error("down"))));
}

async function runAll(breaker: CircuitBreakerPolicy, outcomes: readonly boolean[]): Promise<void> {
  for (const failed of outcomes) {
    await (failed ? fail(breaker) : succeed(breaker));
  }
}

async function open(breaker: CircuitBreakerPolicy): Promise<void> {
  await runAll(breaker, [true, true, true, true]);
}

/** Opens the circuit and lets its wait elapse; the next `execute` half-opens it. */
async function openAndWait({ breaker, time }: Harness): Promise<void> {
  await open(breaker);
  await time.advance(WAIT_MS);
}

function stateChanges(events: readonly CircuitBreakerEvent[]): CircuitStateChangedEvent[] {
  return events.filter((event): event is CircuitStateChangedEvent => event.kind === "circuit-state-changed");
}

function reasons(events: readonly CircuitBreakerEvent[]): string[] {
  return stateChanges(events).map((event) => event.reason);
}

async function refusalOf(breaker: CircuitBreakerPolicy): Promise<CircuitOpenError> {
  const error = await rejectionOf(breaker.execute(() => "never"));
  expect(isCircuitOpenError(error)).toBe(true);
  return error as CircuitOpenError;
}

function errorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

describe("createCircuitBreaker", () => {
  test("exposes its name and starts closed", () => {
    const { breaker } = setup();

    expect(breaker.name).toBe("payments");
    expect(breaker.state).toBe("closed");
  });

  test("validates its configuration", () => {
    expect(isResilienceConfigError(errorOf(() => setup({ minimumCalls: 0 })))).toBe(true);
  });

  test("resolves with the operation's value and rejects with its very error", async () => {
    const { breaker } = setup();
    const failure = new Error("down");

    await expect(breaker.execute(() => Promise.resolve("value"))).resolves.toBe("value");
    await expect(breaker.execute(() => Promise.reject(failure))).rejects.toBe(failure);
  });

  test("passes the operation attempt 1 and the caller's signal", async () => {
    const { breaker } = setup();
    const controller = new AbortController();
    const op = vi.fn(() => "ok");

    await breaker.execute(op, { signal: controller.signal });

    expect(op).toHaveBeenCalledWith({ attempt: 1, signal: controller.signal });
  });
});

describe("admission and transitions", () => {
  test("opens at exactly the threshold once exactly minimumCalls are buffered", async () => {
    const { breaker, events } = setup();

    await runAll(breaker, [false, false, true]);
    expect(breaker.state).toBe("closed");

    await fail(breaker);

    expect(breaker.state).toBe("open");
    expect(events).toEqual([
      { kind: "circuit-state-changed", name: "payments", at: START, from: "closed", to: "open", reason: "failure-rate" },
    ]);
  });

  test("stays closed just below the threshold", async () => {
    const { breaker } = setup({ failureRateThreshold: 51 });

    await runAll(breaker, [false, false, true, true]);

    expect(breaker.state).toBe("closed");
    expect(breaker.metrics.failureRate).toBe(50);
  });

  test("never opens below minimumCalls, however many of the buffered calls failed", async () => {
    const { breaker } = setup({ slidingWindow: { type: "count", size: 10 } });

    await runAll(breaker, [true, true, true]);
    expect(breaker.state).toBe("closed");

    await fail(breaker);
    expect(breaker.state).toBe("open");
  });

  test("outcomes that age out of a time window stop counting", async () => {
    const { breaker, time } = setup({ slidingWindow: { type: "time", size: 1_000 }, minimumCalls: 2 });

    await fail(breaker);
    await time.advance(2_000);
    await fail(breaker);

    expect(breaker.state).toBe("closed");
    expect(breaker.metrics.bufferedCalls).toBe(1);

    await fail(breaker);
    expect(breaker.state).toBe("open");
  });

  test("refuses calls while open without running them", async () => {
    const { breaker } = setup();
    await open(breaker);
    const op = vi.fn(() => "never");

    const error = await rejectionOf(breaker.execute(op));

    expect(isCircuitOpenError(error)).toBe(true);
    expect(op).not.toHaveBeenCalled();
  });

  test("the lazy open to half-open changes the getter alone; the next call transitions and is a probe", async () => {
    const harness = setup();
    const { breaker, time, events } = harness;
    await open(breaker);

    await time.advance(WAIT_MS - 1);
    expect(breaker.state).toBe("open");
    await time.advance(1);
    expect(breaker.state).toBe("half-open");
    expect(reasons(events)).toEqual(["failure-rate"]);

    const probe = deferred();
    const pending = breaker.execute(probe.op);

    expect(reasons(events)).toEqual(["failure-rate", "wait-elapsed"]);
    expect(stateChanges(events)[1]).toMatchObject({ from: "open", to: "half-open", at: START + WAIT_MS });
    probe.resolve("probed");
    await expect(pending).resolves.toBe("probed");
    expect(breaker.metrics.bufferedCalls).toBe(1);
  });

  test("a refusal while open carries the circuit, the state and the remaining wait", async () => {
    const { breaker, time } = setup();
    await open(breaker);
    await time.advance(300);

    const error = await refusalOf(breaker);

    expect(error.circuit).toBe("payments");
    expect(error.state).toBe("open");
    expect(error.remainingMs).toBe(WAIT_MS - 300);
    expect(error.message).toBe('Circuit breaker "payments" is open and refused the call');
  });

  test("a clock stepping back never stretches remainingMs beyond the wait or reads as elapsed", async () => {
    let back = 0;
    const { breaker } = setup({}, () => back);
    await open(breaker);

    back = 500;
    const error = await refusalOf(breaker);

    expect(error.remainingMs).toBe(WAIT_MS);
    expect(breaker.state).toBe("open");
  });

  test("half-open permits count calls in flight; a synchronous burst beyond them is refused", async () => {
    const harness = setup();
    const { breaker, events } = harness;
    await openAndWait(harness);
    const first = deferred();
    const second = deferred();

    const admitted = [breaker.execute(first.op), breaker.execute(second.op)];
    const refused = rejectionOf(breaker.execute(() => "never"));

    const error = (await refused) as CircuitOpenError;
    expect(error.state).toBe("half-open");
    expect(error.remainingMs).toBeUndefined();
    expect(events.at(-1)).toEqual({ kind: "circuit-call-not-permitted", name: "payments", at: START + WAIT_MS, state: "half-open" });
    first.resolve("a");
    second.resolve("b");
    await Promise.all(admitted);
  });

  test("a recorded probe keeps holding its permit", async () => {
    const harness = setup();
    const { breaker } = harness;
    await openAndWait(harness);
    const pending = deferred();

    await succeed(breaker);
    const inFlight = breaker.execute(pending.op);
    await refusalOf(breaker);

    pending.resolve("done");
    await inFlight;
    expect(breaker.state).toBe("closed");
  });

  test("probes below the threshold close the circuit with a fresh window", async () => {
    const harness = setup();
    const { breaker, events } = harness;
    await openAndWait(harness);

    await runAll(breaker, [false, false]);

    expect(breaker.state).toBe("closed");
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "half-open", to: "closed", reason: "half-open-passed" });
    expect(breaker.metrics.bufferedCalls).toBe(0);
    await runAll(breaker, [true, true, true]);
    expect(breaker.state).toBe("closed");
  });

  test("probes at the threshold reopen the circuit for another full wait", async () => {
    const harness = setup();
    const { breaker, events, time } = harness;
    await openAndWait(harness);

    await runAll(breaker, [false, true]);

    expect(breaker.state).toBe("open");
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "half-open", to: "open", reason: "half-open-failed" });
    expect(breaker.metrics.bufferedCalls).toBe(0);
    expect((await refusalOf(breaker)).remainingMs).toBe(WAIT_MS);
    await time.advance(WAIT_MS);
    expect(breaker.state).toBe("half-open");
  });

  test("probes completing out of order are evaluated once every permit has recorded", async () => {
    const harness = setup();
    const { breaker } = harness;
    await openAndWait(harness);
    const first = deferred();
    const second = deferred();
    const firstDone = breaker.execute(first.op);
    const secondDone = rejectionOf(breaker.execute(second.op));

    second.reject(new Error("down"));
    await secondDone;
    expect(breaker.state).toBe("half-open");
    expect(breaker.metrics).toMatchObject({ failureRate: undefined, bufferedCalls: 1, failedCalls: 1 });

    first.resolve("up");
    await firstDone;
    expect(breaker.state).toBe("open");
  });

  test("a half-open circuit past maxWaitInHalfOpenMs reopens on the next call, which is refused", async () => {
    const harness = setup({ maxWaitInHalfOpenMs: 500 });
    const { breaker, time, events } = harness;
    await openAndWait(harness);
    const probe = deferred();
    const probeDone = rejectionOf(breaker.execute(probe.op));

    await time.advance(499);
    expect(breaker.state).toBe("half-open");
    await time.advance(1);
    expect(breaker.state).toBe("open");
    expect(reasons(events)).toEqual(["failure-rate", "wait-elapsed"]);

    const error = await refusalOf(breaker);

    expect(error.state).toBe("open");
    expect(error.remainingMs).toBe(WAIT_MS);
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "half-open", to: "open", reason: "half-open-timed-out", at: time.clock() });
    probe.reject(new Error("late"));
    await probeDone;
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 0, failedCalls: 0, notPermittedCalls: 1 });
    await time.advance(WAIT_MS);
    expect(breaker.state).toBe("half-open");
  });

  test("without maxWaitInHalfOpenMs a half-open circuit waits for its probes indefinitely", async () => {
    const harness = setup();
    const { breaker, time } = harness;
    await openAndWait(harness);
    const probe = deferred();
    const probeDone = breaker.execute(probe.op);

    await time.advance(2_000_000_000);

    expect(breaker.state).toBe("half-open");
    probe.resolve("late");
    await probeDone;
    expect(breaker.metrics.bufferedCalls).toBe(1);
  });

  test("forced-open refuses every call until reset, however long it waits", async () => {
    const { breaker, time, events } = setup();

    breaker.forceOpen();
    await time.advance(10 * WAIT_MS);
    const error = await refusalOf(breaker);

    expect(breaker.state).toBe("forced-open");
    expect(error.state).toBe("forced-open");
    expect(error.remainingMs).toBeUndefined();
    breaker.reset();
    expect(breaker.state).toBe("closed");
    await succeed(breaker);
    expect(stateChanges(events).map(({ from, to, reason }) => [from, to, reason])).toEqual([
      ["closed", "forced-open", "forced-open"],
      ["forced-open", "closed", "reset"],
    ]);
  });

  test("forceOpen while forced open is a no-op", async () => {
    const { breaker, events } = setup();
    breaker.forceOpen();
    await refusalOf(breaker);

    breaker.forceOpen();

    expect(reasons(events)).toEqual(["forced-open"]);
    expect(breaker.metrics.notPermittedCalls).toBe(1);
  });

  test("forceOpen from open or half-open moves to forced-open", async () => {
    const harness = setup();
    const { breaker, events } = harness;
    await openAndWait(harness);
    await succeed(breaker);

    breaker.forceOpen();

    expect(stateChanges(events).at(-1)).toMatchObject({ from: "half-open", to: "forced-open" });
  });

  test("reset from open closes the circuit and emits", async () => {
    const { breaker, events } = setup();
    await open(breaker);

    breaker.reset();

    expect(breaker.state).toBe("closed");
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "open", to: "closed", reason: "reset" });
  });

  test("reset while closed clears the window and counters without an event", async () => {
    const { breaker, events } = setup();
    await runAll(breaker, [true, true, true]);
    await breaker.execute(() => Promise.reject(new BulkheadFullError("full", { bulkhead: "db", reason: "full" }))).catch(() => undefined);

    breaker.reset();

    expect(events).toEqual([]);
    expect(breaker.metrics).toEqual({
      failureRate: undefined,
      bufferedCalls: 0,
      failedCalls: 0,
      successfulCalls: 0,
      notPermittedCalls: 0,
      ignoredCalls: 0,
    });
    await fail(breaker);
    expect(breaker.state).toBe("closed");
  });
});

describe("outcome classification and generations", () => {
  type Driver = (harness: Harness) => Promise<unknown>;
  const drivers: Array<[string, Driver]> = [
    ["failure-rate", ({ breaker }) => open(breaker)],
    [
      "wait-elapsed",
      async (harness) => {
        await openAndWait(harness);
        await succeed(harness.breaker);
      },
    ],
    [
      "half-open-passed",
      async (harness) => {
        await openAndWait(harness);
        await runAll(harness.breaker, [false, false]);
      },
    ],
    [
      "half-open-failed",
      async (harness) => {
        await openAndWait(harness);
        await runAll(harness.breaker, [true, true]);
      },
    ],
    [
      "half-open-timed-out",
      async (harness) => {
        await openAndWait(harness);
        void harness.breaker.execute(deferred().op);
        await harness.time.advance(500);
        await refusalOf(harness.breaker);
      },
    ],
    ["reset", async ({ breaker }) => breaker.reset()],
    ["forced-open", async ({ breaker }) => breaker.forceOpen()],
  ];

  test.each(drivers)("an outcome admitted before a %s transition is dropped", async (_, drive) => {
    const harness = setup({ maxWaitInHalfOpenMs: 500 });
    const { breaker } = harness;
    const slow = deferred();
    const failure = new Error("slow");
    const slowDone = rejectionOf(breaker.execute(slow.op));

    await drive(harness);
    const before = breaker.metrics;
    slow.reject(failure);

    expect(await slowDone).toBe(failure);
    expect(breaker.metrics).toEqual(before);
  });

  test("a stale outcome the built-in rule ignores is not counted as ignored", async () => {
    const { breaker } = setup();
    const slow = deferred();
    const slowDone = rejectionOf(breaker.execute(slow.op));
    breaker.reset();

    slow.reject(new RateLimitExceededError("limited", { limiter: "api", permits: 1, retryAfterMs: 250 }));
    await slowDone;

    expect(breaker.metrics.ignoredCalls).toBe(0);
  });

  const refusals: Array<[string, () => Error]> = [
    ["RateLimitExceededError", () => new RateLimitExceededError("limited", { limiter: "api", permits: 1, retryAfterMs: 250 })],
    ["BulkheadFullError", () => new BulkheadFullError("full", { bulkhead: "db", reason: "full" })],
    ["CircuitOpenError", () => new CircuitOpenError("downstream open", { circuit: "inner", state: "open", remainingMs: 5 })],
  ];

  test.each(refusals)("a %s is ignored while closed", async (_, build) => {
    const { breaker } = setup({ minimumCalls: 1 });
    const refusal = build();

    await expect(breaker.execute(() => Promise.reject(refusal))).rejects.toBe(refusal);

    expect(breaker.state).toBe("closed");
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 0, ignoredCalls: 1 });
  });

  test("a call whose signal aborted by its completion is ignored, and its value still returned", async () => {
    const { breaker } = setup({ minimumCalls: 1 });
    const controller = new AbortController();

    const value = await breaker.execute(
      () => {
        controller.abort();
        return "finished anyway";
      },
      { signal: controller.signal },
    );

    expect(value).toBe("finished anyway");
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 0, ignoredCalls: 1 });
  });

  const halfOpenIgnores: Array<[string, (breaker: CircuitBreakerPolicy) => Promise<unknown>]> = [
    ...refusals.map(([label, build]): [string, (breaker: CircuitBreakerPolicy) => Promise<unknown>] => [
      label,
      (breaker) => rejectionOf(breaker.execute(() => Promise.reject(build()))),
    ]),
    [
      "caller abort",
      (breaker) => {
        const controller = new AbortController();
        return rejectionOf(
          breaker.execute(
            () => {
              controller.abort();
              return Promise.reject(new Error("aborted"));
            },
            { signal: controller.signal },
          ),
        );
      },
    ],
  ];

  test.each(halfOpenIgnores)("an ignored %s releases its half-open permit", async (_, ignoredCall) => {
    const harness = setup();
    const { breaker } = harness;
    await openAndWait(harness);

    await ignoredCall(breaker);

    expect(breaker.state).toBe("half-open");
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 0, ignoredCalls: 1 });
    await runAll(breaker, [false, false]);
    expect(breaker.state).toBe("closed");
  });

  test("a pre-aborted signal rejects with its reason before admission and is not counted", async () => {
    const { breaker, events } = setup();
    await open(breaker);
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    controller.abort(reason);
    const op = vi.fn(() => "never");

    await expect(breaker.execute(op, { signal: controller.signal })).rejects.toBe(reason);

    expect(op).not.toHaveBeenCalled();
    expect(breaker.metrics).toMatchObject({ notPermittedCalls: 0, ignoredCalls: 0 });
    expect(events.filter((event) => event.kind === "circuit-call-not-permitted")).toEqual([]);
  });

  test("a synchronous throw from the operation is a recorded failure", async () => {
    const { breaker } = setup();
    const failure = new Error("sync");

    await expect(
      breaker.execute(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(breaker.metrics).toMatchObject({ bufferedCalls: 1, failedCalls: 1 });
  });

  test("a custom isFailure sees ok outcomes and may flag them as failures", async () => {
    const seen: Array<Outcome<unknown>> = [];
    const { breaker } = setup({
      minimumCalls: 1,
      isFailure(outcome) {
        seen.push(outcome);
        return outcome.ok && outcome.value === "degraded";
      },
    });

    await expect(breaker.execute(() => "degraded")).resolves.toBe("degraded");

    expect(seen).toEqual([{ ok: true, value: "degraded" }]);
    expect(breaker.state).toBe("open");
  });

  test("a custom isFailure may count an error as a success", async () => {
    const { breaker } = setup({ minimumCalls: 1, isFailure: () => false });

    await fail(breaker);

    expect(breaker.state).toBe("closed");
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 1, successfulCalls: 1 });
  });

  test("a throwing isFailure counts the outcome as a failure and the caller still gets the operation's value", async () => {
    const { breaker, events } = setup({
      minimumCalls: 1,
      isFailure() {
        throw new Error("classifier broke");
      },
    });

    await expect(breaker.execute(() => "fine")).resolves.toBe("fine");

    expect(breaker.state).toBe("open");
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "closed", to: "open", reason: "failure-rate" });
  });

  test("a throwing isFailure on a half-open probe releases its permit and the caller still gets the operation's error", async () => {
    const failure = new Error("probe down");
    let classifierBroken = false;
    const harness = setup({
      isFailure(outcome) {
        if (classifierBroken) {
          throw new Error("classifier broke");
        }
        return !outcome.ok;
      },
    });
    const { breaker, events } = harness;
    await openAndWait(harness);
    classifierBroken = true;

    await succeed(breaker);
    expect(breaker.metrics).toMatchObject({ bufferedCalls: 1, failedCalls: 1 });
    await expect(breaker.execute(() => Promise.reject(failure))).rejects.toBe(failure);

    expect(breaker.state).toBe("open");
    expect(stateChanges(events).at(-1)).toMatchObject({ from: "half-open", to: "open", reason: "half-open-failed" });
  });
});

describe("metrics and events", () => {
  test("a closed circuit has no failure rate below minimumCalls", async () => {
    const { breaker } = setup({ slidingWindow: { type: "count", size: 10 } });

    expect(breaker.metrics.failureRate).toBeUndefined();
    await runAll(breaker, [false, false, true]);
    expect(breaker.metrics).toEqual({
      failureRate: undefined,
      bufferedCalls: 3,
      failedCalls: 1,
      successfulCalls: 2,
      notPermittedCalls: 0,
      ignoredCalls: 0,
    });

    await succeed(breaker);
    expect(breaker.metrics.failureRate).toBe(25);
  });

  test("an open circuit counts refusals and has no failure rate", async () => {
    const { breaker } = setup();
    await open(breaker);
    await refusalOf(breaker);
    await refusalOf(breaker);

    expect(breaker.metrics).toEqual({
      failureRate: undefined,
      bufferedCalls: 0,
      failedCalls: 0,
      successfulCalls: 0,
      notPermittedCalls: 2,
      ignoredCalls: 0,
    });
  });

  test("a half-open circuit has no failure rate until every probe has recorded", async () => {
    const harness = setup({ permittedCallsInHalfOpen: 3, failureRateThreshold: 100 });
    const { breaker } = harness;
    await openAndWait(harness);

    await runAll(breaker, [true, false]);

    expect(breaker.metrics).toEqual({
      failureRate: undefined,
      bufferedCalls: 2,
      failedCalls: 1,
      successfulCalls: 1,
      notPermittedCalls: 0,
      ignoredCalls: 0,
    });
  });

  test("a forced-open circuit has no failure rate", async () => {
    const { breaker } = setup();
    await runAll(breaker, [false, false, false, false]);

    breaker.forceOpen();

    expect(breaker.metrics).toMatchObject({ failureRate: undefined, bufferedCalls: 0 });
  });

  test("metrics are a frozen snapshot", () => {
    expect(Object.isFrozen(setup().breaker.metrics)).toBe(true);
  });

  test("the open period's counters stay visible while the getter reads half-open, and reset on the transition", async () => {
    const { breaker, time } = setup();
    await breaker.execute(() => Promise.reject(new BulkheadFullError("full", { bulkhead: "db", reason: "full" }))).catch(() => undefined);
    expect(breaker.metrics.ignoredCalls).toBe(1);
    await open(breaker);
    expect(breaker.metrics.ignoredCalls).toBe(0);
    await refusalOf(breaker);

    await time.advance(WAIT_MS);

    expect(breaker.state).toBe("half-open");
    expect(breaker.metrics.notPermittedCalls).toBe(1);
    await succeed(breaker);
    expect(breaker.metrics).toMatchObject({ notPermittedCalls: 0, bufferedCalls: 1 });
  });

  test("reads never transition or emit", async () => {
    const { breaker, time, events } = setup({ maxWaitInHalfOpenMs: 500 });
    await open(breaker);
    await time.advance(WAIT_MS);
    const count = events.length;

    for (let i = 0; i < 3; i += 1) {
      void breaker.state;
      void breaker.metrics;
    }

    expect(events).toHaveLength(count);
    expect(breaker.metrics.notPermittedCalls).toBe(0);
  });

  test("emits one circuit-state-changed per reason and a circuit-call-not-permitted per refusal", async () => {
    const harness = setup({ maxWaitInHalfOpenMs: 500 });
    const { breaker, time, events } = harness;

    await open(breaker);
    await time.advance(WAIT_MS);
    await runAll(breaker, [false, false]);
    await open(breaker);
    await time.advance(WAIT_MS);
    await runAll(breaker, [true, true]);
    await time.advance(WAIT_MS);
    void breaker.execute(deferred().op);
    await time.advance(500);
    await refusalOf(breaker);
    breaker.forceOpen();
    await refusalOf(breaker);
    breaker.reset();

    expect(reasons(events)).toEqual([
      "failure-rate",
      "wait-elapsed",
      "half-open-passed",
      "failure-rate",
      "wait-elapsed",
      "half-open-failed",
      "wait-elapsed",
      "half-open-timed-out",
      "forced-open",
      "reset",
    ]);
    expect(events.filter((event) => event.kind === "circuit-call-not-permitted").map((event) => event.state)).toEqual([
      "open",
      "forced-open",
    ]);
    expect(events.every((event) => event.name === "payments")).toBe(true);
  });

  test("a throwing listener breaks neither the breaker nor the listeners after it", async () => {
    const { breaker, events } = setup();
    const after: CircuitBreakerEvent[] = [];
    breaker.events.on(() => {
      throw new Error("listener");
    });
    breaker.events.on((event) => after.push(event));

    await open(breaker);
    await refusalOf(breaker);

    expect(breaker.state).toBe("open");
    expect(after).toHaveLength(2);
    expect(events).toHaveLength(2);
  });
});

describe("default dependencies", () => {
  test("run against the system clock", async () => {
    const breaker = createCircuitBreaker("system", {
      failureRateThreshold: 50,
      slidingWindow: { type: "time", size: 60_000 },
      minimumCalls: 1,
      waitDurationInOpenMs: 60_000,
      permittedCallsInHalfOpen: 1,
    });
    const events: CircuitBreakerEvent[] = [];
    breaker.events.on((event) => events.push(event));
    const before = performance.timeOrigin + performance.now();

    await expect(breaker.execute(() => "ok")).resolves.toBe("ok");
    breaker.forceOpen();

    expect(events[0]?.at).toBeGreaterThanOrEqual(before);
    expect(breaker.state).toBe("forced-open");
  });
});
