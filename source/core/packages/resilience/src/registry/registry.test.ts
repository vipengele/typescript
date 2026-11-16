import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import { isBulkheadFullError, isRateLimitExceededError, isResilienceConfigError } from "../errors";
import { fixedBackoff } from "../retry";
import { builtInDefaults, createRegistry, type ResilienceEvent, type ResilienceRegistry } from "./index";
import type { PolicyKind } from "./types";

const START = 1_000;

function errorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

function create(registry: ResilienceRegistry, kind: PolicyKind, name: string, override?: object): unknown {
  return registry[kind](name, override);
}

const kinds: PolicyKind[] = ["retry", "circuitBreaker", "rateLimiter", "timeout", "bulkhead"];

describe("createRegistry", () => {
  test("creates every kind from the built-in defaults without a build callback", () => {
    const registry = createRegistry();

    for (const kind of kinds) {
      expect((create(registry, kind, "api") as { name: string }).name).toBe("api");
    }
    expect(Object.keys(builtInDefaults).sort()).toEqual([...kinds].sort());
  });

  test.each(kinds)("%s throws a ResilienceConfigError for an empty name", (kind) => {
    expect(isResilienceConfigError(errorOf(() => create(createRegistry(), kind, "")))).toBe(true);
  });
});

describe("instances", () => {
  test.each(kinds)("%s returns one instance per name", (kind) => {
    const registry = createRegistry();

    const first = create(registry, kind, "api");

    expect(create(registry, kind, "api")).toBe(first);
    expect(create(registry, kind, "api", undefined)).toBe(first);
    expect(create(registry, kind, "other")).not.toBe(first);
  });

  test("different kinds sharing a name are distinct instances", () => {
    const registry = createRegistry();

    const policies = kinds.map((kind) => create(registry, kind, "shared"));

    expect(new Set(policies).size).toBe(kinds.length);
  });

  test.each([
    ["an empty override", {}],
    ["an override equal to the effective config", { maxAttempts: 3 }],
    ["a function-valued override", { backoff: fixedBackoff(500) }],
  ])("%s on an existing instance throws a ResilienceConfigError", (_, override) => {
    const registry = createRegistry();
    registry.retry("api");

    const error = errorOf(() => registry.retry("api", override));

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('retry "api"');
  });

  test("an override on the creating call applies", async () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) => b.clock(time.clock).scheduler(time.scheduler));
    const bulkhead = registry.bulkhead("api", { maxConcurrent: 1 });

    void bulkhead.execute(() => new Promise<never>(() => {}));

    expect(isBulkheadFullError(await bulkhead.execute(() => "ran").catch((error: unknown) => error))).toBe(true);
  });
});

describe("factory errors", () => {
  test("wraps an inherited cross-field violation, naming the kind and the name, with the factory error as cause", () => {
    const registry = createRegistry((b) => b.defaults("circuitBreaker", { slidingWindow: { type: "count", size: 5 } }));

    const error = errorOf(() => registry.circuitBreaker("api", { failureRateThreshold: 25 }));

    expect(isResilienceConfigError(error)).toBe(true);
    const { message, cause } = error as Error;
    expect(message).toContain('circuitBreaker "api"');
    expect(message).toContain("built-in defaults ← defaults ← configure ← override");
    expect(isResilienceConfigError(cause)).toBe(true);
    expect((cause as Error).message).toContain("minimumCalls");
  });

  test("wraps a bulkhead maxWaitMs inherited without a queue", () => {
    const registry = createRegistry((b) => b.defaults("bulkhead", { maxWaitMs: 100 }));

    const error = errorOf(() => registry.bulkhead("api", { maxConcurrent: 2 }));

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('bulkhead "api"');
    expect(String((error as Error).cause)).toContain("maxWaitMs");
  });

  test("leaves a failed creation uncached, so a corrected override creates the policy", () => {
    const registry = createRegistry((b) => b.defaults("bulkhead", { maxWaitMs: 100 }));
    errorOf(() => registry.bulkhead("api"));

    expect(registry.bulkhead("api", { maxQueue: 1 }).name).toBe("api");
  });

  test("rethrows an error that is not a ResilienceConfigError unchanged", () => {
    const registry = createRegistry((b) => b.configure("circuitBreaker", "api", { slidingWindow: null as never }));

    const error = errorOf(() => registry.circuitBreaker("api"));

    expect(error).toBeInstanceOf(TypeError);
    expect(isResilienceConfigError(error)).toBe(false);
  });
});

describe("events", () => {
  function rejectingRegistry() {
    const time = createManualTime(START);
    return createRegistry((b) =>
      b
        .clock(time.clock)
        .scheduler(time.scheduler)
        .defaults("rateLimiter", { limitForPeriod: 1, maxWaitMs: 0 })
        .defaults("bulkhead", { maxConcurrent: 1 }),
    );
  }

  async function rejectOnce(registry: ResilienceRegistry, kind: "rateLimiter" | "bulkhead", name: string): Promise<void> {
    const policy = kind === "rateLimiter" ? registry.rateLimiter(name) : registry.bulkhead(name);
    void policy.execute(() => new Promise<never>(() => {}));
    const error = await policy.execute(() => "ran").catch((caught: unknown) => caught);
    expect(isRateLimitExceededError(error) || isBulkheadFullError(error)).toBe(true);
  }

  test("aggregates policies created before and after the listener was added", async () => {
    const registry = rejectingRegistry();
    registry.bulkhead("early");
    const events: ResilienceEvent[] = [];
    registry.events.on((event) => events.push(event));

    await rejectOnce(registry, "bulkhead", "early");
    await rejectOnce(registry, "rateLimiter", "late");

    expect(events.map(({ kind, name }) => [kind, name])).toEqual([
      ["bulkhead-rejected", "early"],
      ["rate-limit-exceeded", "late"],
    ]);
  });

  test("stops delivering to an unsubscribed listener", async () => {
    const registry = rejectingRegistry();
    const events: ResilienceEvent[] = [];
    const unsubscribe = registry.events.on((event) => events.push(event));

    await rejectOnce(registry, "bulkhead", "first");
    unsubscribe();
    await rejectOnce(registry, "bulkhead", "second");

    expect(events.map(({ name }) => name)).toEqual(["first"]);
  });

  test("a throwing listener does not stop the others", async () => {
    const registry = rejectingRegistry();
    const events: ResilienceEvent[] = [];
    registry.events.on(() => {
      throw new Error("listener failed");
    });
    registry.events.on((event) => events.push(event));

    await rejectOnce(registry, "rateLimiter", "api");

    expect(events.map(({ kind }) => kind)).toEqual(["rate-limit-exceeded"]);
  });
});

describe("kinds", () => {
  test("lists the kinds with a configure entry in pipeline order", () => {
    const registry = createRegistry((b) =>
      b.configure("bulkhead", "api", { maxConcurrent: 2 }).configure("retry", "api", { maxAttempts: 2 }),
    );

    expect(registry.kinds("api")).toEqual(["retry", "bulkhead"]);
  });

  test("lists the kinds with an existing instance in pipeline order", () => {
    const registry = createRegistry();
    registry.timeout("api");
    registry.circuitBreaker("api");
    registry.timeout("other");

    expect(registry.kinds("api")).toEqual(["circuitBreaker", "timeout"]);
  });

  test("combines configured kinds and existing instances", () => {
    const registry = createRegistry((b) => b.configure("rateLimiter", "api", { limitForPeriod: 1 }));
    registry.retry("api");

    expect(registry.kinds("api")).toEqual(["retry", "rateLimiter"]);
  });

  test("a defaults entry alone does not count", () => {
    const registry = createRegistry((b) => b.defaults("timeout", { durationMs: 5 }));

    expect(registry.kinds("api")).toEqual([]);
  });

  test("returns an empty list when nothing is configured and creates nothing", () => {
    const registry = createRegistry();

    expect(registry.kinds("api")).toEqual([]);
    expect(registry.kinds("api")).toEqual([]);
    expect(() => registry.pipeline("api")).toThrow(/has no kinds/);
  });

  test("returns explicit kinds in pipeline order without creating them", () => {
    const registry = createRegistry();

    expect(registry.kinds("api", { kinds: ["bulkhead", "retry"] })).toEqual(["retry", "bulkhead"]);
    expect(registry.kinds("api")).toEqual([]);
  });

  test("rejects an empty, duplicated or unknown explicit kinds", () => {
    const registry = createRegistry();

    expect(isResilienceConfigError(errorOf(() => registry.kinds("api", { kinds: [] })))).toBe(true);
    expect(isResilienceConfigError(errorOf(() => registry.kinds("api", { kinds: ["retry", "retry"] })))).toBe(true);
    expect(isResilienceConfigError(errorOf(() => registry.kinds("api", { kinds: ["nope" as PolicyKind] })))).toBe(true);
  });

  test("throws a ResilienceConfigError for an empty name", () => {
    expect(isResilienceConfigError(errorOf(() => createRegistry().kinds("")))).toBe(true);
  });

  test("pipeline composes the kinds it reports", () => {
    const registry = createRegistry((b) => b.configure("timeout", "api", { durationMs: 10 }));

    expect(registry.kinds("api")).toEqual(["timeout"]);
    registry.pipeline("api");
    expect(registry.kinds("api")).toEqual(["timeout"]);
  });
});
