import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import { isBulkheadFullError, isOperationTimeoutError, isRateLimitExceededError, isResilienceConfigError } from "../errors";
import type { RateLimiterPolicy } from "../rate-limiter";
import { fixedBackoff } from "../retry";
import type { RegistryBuilder } from "./builder";
import { createRegistry } from "./registry";
import type { PolicyKind, RegistryBuilderLayer, ResilienceEvent } from "./types";

const START = 1_000;

/** Lets an `execute` that registers its sleep after an await reach that registration. */
async function untilPending(time: ManualTime, count: number): Promise<void> {
  for (let i = 0; i < 50 && time.pendingSleeps !== count; i += 1) {
    await Promise.resolve();
  }
  expect(time.pendingSleeps).toBe(count);
}

function errorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

/** The permits a fresh limiter hands out before its clock moves: its effective `limitForPeriod`. */
function drain(limiter: RateLimiterPolicy): number {
  let taken = 0;
  while (taken < 100 && limiter.tryAcquire()) {
    taken += 1;
  }
  return taken;
}

/** The `retryAfterMs` of a call refused at once, or `"waits"` when the call is queued for a permit. */
async function nextCall(limiter: RateLimiterPolicy, time: ManualTime): Promise<number | "waits"> {
  const result = limiter.execute(() => "ran").catch((error: unknown) => error);
  await Promise.resolve();
  if (time.pendingSleeps > 0) {
    return "waits";
  }
  const error = await result;
  return isRateLimitExceededError(error) ? error.retryAfterMs : Number.NaN;
}

describe("layer precedence", () => {
  test("the override beats configure, which beats defaults, which beats the built-in defaults", async () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) =>
      b
        .clock(time.clock)
        .scheduler(time.scheduler)
        .defaults("rateLimiter", { limitForPeriod: 2, refreshPeriodMs: 100 })
        .configure("rateLimiter", "api", { limitForPeriod: 3, maxWaitMs: 0 }),
    );

    const overridden = registry.rateLimiter("api", { limitForPeriod: 4 });

    expect(drain(overridden)).toBe(4);
    expect(await nextCall(overridden, time)).toBe(100);
  });

  test("a name without configure takes defaults over the built-in defaults", async () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) =>
      b
        .clock(time.clock)
        .scheduler(time.scheduler)
        .defaults("rateLimiter", { limitForPeriod: 2 })
        .configure("rateLimiter", "api", { limitForPeriod: 3, maxWaitMs: 0 }),
    );

    const configured = registry.rateLimiter("api");
    const other = registry.rateLimiter("other");

    expect(drain(configured)).toBe(3);
    expect(await nextCall(configured, time)).toBe(500);
    expect(drain(other)).toBe(2);
    expect(await nextCall(other, time)).toBe("waits");
  });

  test("layers of one stage apply in call order", () => {
    const registry = createRegistry((b) =>
      b
        .defaults("rateLimiter", { limitForPeriod: 2 })
        .defaults("rateLimiter", { limitForPeriod: 5 })
        .configure("rateLimiter", "api", { limitForPeriod: 7 })
        .configure("rateLimiter", "api", { limitForPeriod: 6 }),
    );

    expect(drain(registry.rateLimiter("api"))).toBe(6);
    expect(drain(registry.rateLimiter("other"))).toBe(5);
  });

  test("fromConfig layers interleave with defaults and configure calls in call order", () => {
    const registry = createRegistry((b) =>
      b
        .configure("rateLimiter", "first", { limitForPeriod: 2 })
        .defaults("rateLimiter", { limitForPeriod: 9 })
        .fromConfig({
          defaults: { rateLimiter: { limitForPeriod: 4 } },
          configure: { rateLimiter: { first: { limitForPeriod: 3 }, second: { limitForPeriod: 3 } } },
        })
        .configure("rateLimiter", "second", { limitForPeriod: 5 }),
    );

    expect(drain(registry.rateLimiter("first"))).toBe(3);
    expect(drain(registry.rateLimiter("second"))).toBe(5);
    expect(drain(registry.rateLimiter("third"))).toBe(4);
  });

  test("a fromConfig default stays below a configure layer added before it", () => {
    const registry = createRegistry((b) =>
      b.configure("rateLimiter", "api", { limitForPeriod: 2 }).fromConfig({ defaults: { rateLimiter: { limitForPeriod: 8 } } }),
    );

    expect(drain(registry.rateLimiter("api"))).toBe(2);
  });

  test("a fromConfig layer with neither section adds nothing", () => {
    const registry = createRegistry((b) => b.fromConfig({}));

    expect(drain(registry.rateLimiter("api"))).toBe(50);
  });

  test("a nested slidingWindow is replaced whole, not merged field by field", () => {
    const registry = createRegistry((b) =>
      b
        .defaults("circuitBreaker", { slidingWindow: { type: "count", size: 2 }, minimumCalls: 2 })
        .configure("circuitBreaker", "api", { slidingWindow: { type: "time" } as never }),
    );

    const error = errorOf(() => registry.circuitBreaker("api"));

    expect(isResilienceConfigError(error)).toBe(true);
    expect(String((error as Error).cause)).toContain("slidingWindow.size");
  });

  test("a field set to undefined is skipped at every layer", async () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) =>
      b
        .clock(time.clock)
        .scheduler(time.scheduler)
        .defaults("rateLimiter", { limitForPeriod: 2, maxWaitMs: 0 })
        .configure("rateLimiter", "api", { limitForPeriod: undefined }),
    );

    const limiter = registry.rateLimiter("api", { maxWaitMs: undefined });

    expect(drain(limiter)).toBe(2);
    expect(await nextCall(limiter, time)).toBe(500);
  });

  test("a layer is copied when added, so mutating its object afterwards changes nothing", () => {
    const layer = { limitForPeriod: 2 };
    const registry = createRegistry((b) => {
      b.defaults("rateLimiter", layer);
      layer.limitForPeriod = 7;
    });

    expect(drain(registry.rateLimiter("api"))).toBe(2);
  });

  test.each(["defaults", "configure", "fromConfig"] as const)(
    "a nested value in a %s layer is copied, so mutating it afterwards changes nothing",
    async (method) => {
      const window: { type: "count"; size: number } = { type: "count", size: 2 };
      const layer = { slidingWindow: window, minimumCalls: 2, failureRateThreshold: 50 };
      const registry = createRegistry((b) => {
        if (method === "defaults") {
          b.defaults("circuitBreaker", layer);
        } else if (method === "configure") {
          b.configure("circuitBreaker", "api", layer);
        } else {
          b.fromConfig({ configure: { circuitBreaker: { api: layer } } });
        }
        window.size = 1;
      });

      const breaker = registry.circuitBreaker("api");
      const fail = (): Promise<never> => Promise.reject(new Error("down"));
      await breaker.execute(fail).catch(() => undefined);
      await breaker.execute(fail).catch(() => undefined);

      expect(breaker.state).toBe("open");
    },
  );

  test("a function in a layer is kept by reference", async () => {
    let asked = 0;
    const shouldRetry = (): boolean => {
      asked += 1;
      return false;
    };
    const registry = createRegistry((b) => b.configure("retry", "api", { maxAttempts: 2, shouldRetry }));

    await registry
      .retry("api")
      .execute(() => Promise.reject(new Error("down")))
      .catch(() => undefined);

    expect(asked).toBe(1);
  });
});

describe("kind and name checks", () => {
  const unknown = "nope" as PolicyKind;
  const cases: Array<[string, (b: RegistryBuilder) => unknown]> = [
    ["defaults with an unknown kind", (b) => b.defaults(unknown, {})],
    ["configure with an unknown kind", (b) => b.configure(unknown, "api", {})],
    ["configure with an empty name", (b) => b.configure("retry", "", {})],
    ["fromConfig with an unknown defaults kind", (b) => b.fromConfig({ defaults: { nope: {} } } as RegistryBuilderLayer)],
    ["fromConfig with an unknown configure kind", (b) => b.fromConfig({ configure: { nope: { api: {} } } } as RegistryBuilderLayer)],
    ["fromConfig with an empty configure name", (b) => b.fromConfig({ configure: { retry: { "": {} } } })],
  ];

  test.each(cases)("%s throws a ResilienceConfigError", (_, build) => {
    expect(isResilienceConfigError(errorOf(() => createRegistry(build)))).toBe(true);
  });

  test("an unknown kind's error names the known kinds", () => {
    const error = errorOf(() => createRegistry((b) => b.defaults(unknown, {})));

    expect((error as Error).message).toContain('"nope"');
    expect((error as Error).message).toContain("retry, circuitBreaker, rateLimiter, timeout, bulkhead");
  });
});

describe("builder lifetime", () => {
  test("every method returns the builder", () => {
    const time = createManualTime(START);
    createRegistry((b) => {
      expect(b.defaults("retry", {})).toBe(b);
      expect(b.configure("retry", "api", {})).toBe(b);
      expect(b.fromConfig({})).toBe(b);
      expect(b.clock(time.clock)).toBe(b);
      expect(b.scheduler(time.scheduler)).toBe(b);
    });
  });

  test("ignores the build callback's return value", () => {
    const registry = createRegistry((b) => b.defaults("retry", { maxAttempts: 1 }));

    expect(registry.retry("api").name).toBe("api");
  });

  test("every method throws a ResilienceConfigError once build has returned", () => {
    const time = createManualTime(START);
    let kept: RegistryBuilder | undefined;
    createRegistry((b) => {
      kept = b;
    });
    const builder = kept as RegistryBuilder;

    const uses: Array<() => unknown> = [
      () => builder.defaults("retry", {}),
      () => builder.configure("retry", "api", {}),
      () => builder.fromConfig({}),
      () => builder.clock(time.clock),
      () => builder.scheduler(time.scheduler),
    ];

    for (const use of uses) {
      expect(isResilienceConfigError(errorOf(use))).toBe(true);
    }
  });
});

describe("injected clock and scheduler", () => {
  function registryOn(time: ManualTime) {
    return createRegistry((b) => b.clock(time.clock).scheduler(time.scheduler));
  }

  function collect(registry: ReturnType<typeof createRegistry>): ResilienceEvent[] {
    const events: ResilienceEvent[] = [];
    registry.events.on((event) => events.push(event));
    return events;
  }

  test("reach a retry", async () => {
    const time = createManualTime(START);
    const registry = registryOn(time);
    const events = collect(registry);
    const retry = registry.retry("api", { maxAttempts: 2, backoff: fixedBackoff(40) });
    let calls = 0;

    const result = retry.execute(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("first attempt fails");
      }
      return "done";
    });
    await untilPending(time, 1);
    await time.advance(40);

    await expect(result).resolves.toBe("done");
    expect(events).toEqual([expect.objectContaining({ kind: "retry", at: START, delayMs: 40 })]);
  });

  test("reach a circuit breaker's clock", async () => {
    const time = createManualTime(START);
    const registry = registryOn(time);
    const events = collect(registry);
    const breaker = registry.circuitBreaker("api", {
      slidingWindow: { type: "count", size: 1 },
      minimumCalls: 1,
      waitDurationInOpenMs: 200,
    });

    await expect(breaker.execute(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(breaker.state).toBe("open");
    await time.advance(200);

    expect(breaker.state).toBe("half-open");
    expect(events).toEqual([expect.objectContaining({ kind: "circuit-state-changed", at: START, to: "open" })]);
  });

  test("reach a rate limiter", async () => {
    const time = createManualTime(START);
    const registry = registryOn(time);
    const events = collect(registry);
    const limiter = registry.rateLimiter("api", { limitForPeriod: 1, refreshPeriodMs: 100 });
    expect(limiter.tryAcquire()).toBe(true);

    const result = limiter.execute(() => "ran");
    await untilPending(time, 1);
    await time.advance(100);

    await expect(result).resolves.toBe("ran");
    expect(events).toEqual([expect.objectContaining({ kind: "rate-limit-waited", at: START + 100, waitMs: 100 })]);
  });

  test("reach a timeout", async () => {
    const time = createManualTime(START);
    const registry = registryOn(time);
    const events = collect(registry);
    const timeout = registry.timeout("api", { durationMs: 70 });

    const result = timeout.execute(() => new Promise<never>(() => {})).catch((error: unknown) => error);
    await untilPending(time, 1);
    await time.advance(70);

    expect(isOperationTimeoutError(await result)).toBe(true);
    expect(events).toEqual([expect.objectContaining({ kind: "timeout", at: START + 70 })]);
  });

  test("reach a bulkhead", async () => {
    const time = createManualTime(START);
    const registry = registryOn(time);
    const events = collect(registry);
    const bulkhead = registry.bulkhead("api", { maxConcurrent: 1, maxQueue: 1, maxWaitMs: 30 });

    void bulkhead.execute(() => new Promise<never>(() => {}));
    const queued = bulkhead.execute(() => "ran").catch((error: unknown) => error);
    await untilPending(time, 1);
    await time.advance(30);

    expect(isBulkheadFullError(await queued)).toBe(true);
    expect(events).toEqual([expect.objectContaining({ kind: "bulkhead-rejected", at: START + 30, reason: "wait-timeout" })]);
  });
});
