import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import { isBulkheadFullError, isRateLimitExceededError, isResilienceConfigError } from "../errors";
import { fixedBackoff } from "../retry";
import { createRegistry, type ResilienceEvent } from "./index";
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

describe("pipeline kinds", () => {
  test("defaults to the kinds configured for the name plus those already created, ignoring kind-level defaults", async () => {
    const registry = createRegistry((b) => b.defaults("bulkhead", { maxConcurrent: 1 }).configure("timeout", "api", { durationMs: 50 }));
    const retry = registry.retry("api");
    const events: ResilienceEvent[] = [];
    registry.events.on((event) => events.push(event));

    await registry.pipeline("api").execute(() => "ran");

    expect(registry.retry("api")).toBe(retry);
    expect(isResilienceConfigError(errorOf(() => registry.timeout("api", { durationMs: 10 })))).toBe(true);
    expect(registry.bulkhead("api", { maxConcurrent: 2 }).name).toBe("api");
    expect(events).toEqual([]);
  });

  test("throws when the name has nothing configured or created, even with kind-level defaults", () => {
    const registry = createRegistry((b) => b.defaults("retry", { maxAttempts: 2 }).configure("retry", "other", {}));

    const error = errorOf(() => registry.pipeline("api"));

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('"api"');
  });

  test("nests explicit kinds in the fixed order whatever order they are listed in", async () => {
    const time = createManualTime(START);
    // The manual clock never reaches the limiter's next period; the retry's zero backoff runs on the system scheduler.
    const registry = createRegistry((b) =>
      b
        .clock(time.clock)
        .configure("retry", "api", { maxAttempts: 3, backoff: fixedBackoff(0) })
        .configure("rateLimiter", "api", { limitForPeriod: 1, maxWaitMs: 0 }),
    );
    let calls = 0;

    const error = await registry
      .pipeline("api", { kinds: ["rateLimiter", "retry"] })
      .execute(() => {
        calls += 1;
        throw new Error("failed");
      })
      .catch((caught: unknown) => caught);

    // Retry outermost: its second attempt meets the exhausted rate limiter, so the operation runs once.
    expect(isRateLimitExceededError(error)).toBe(true);
    expect(calls).toBe(1);
  });

  test("composes all five kinds listed in reverse", async () => {
    const registry = createRegistry();
    const kinds: PolicyKind[] = ["bulkhead", "timeout", "rateLimiter", "circuitBreaker", "retry"];

    await expect(registry.pipeline("api", { kinds }).execute(({ attempt }) => attempt)).resolves.toBe(1);
  });

  test.each([
    ["an empty kinds list", []],
    ["a duplicate kind", ["retry", "timeout", "retry"]],
    ["an unknown kind", ["retry", "fallback"]],
  ])("throws a ResilienceConfigError for %s", (_, kinds) => {
    const registry = createRegistry();

    const error = errorOf(() => registry.pipeline("api", { kinds: kinds as PolicyKind[] }));

    expect(isResilienceConfigError(error)).toBe(true);
    expect(isResilienceConfigError(errorOf(() => registry.retry("api", { maxAttempts: 2 })))).toBe(false);
  });

  test("throws a ResilienceConfigError for an empty name", () => {
    expect(isResilienceConfigError(errorOf(() => createRegistry().pipeline("", { kinds: ["retry"] })))).toBe(true);
  });
});

describe("pipeline instances", () => {
  test("reuses an existing instance", async () => {
    const registry = createRegistry();
    const bulkhead = registry.bulkhead("api", { maxConcurrent: 1 });
    void bulkhead.execute(() => new Promise<never>(() => {}));

    const error = await registry
      .pipeline("api", { kinds: ["bulkhead"] })
      .execute(() => "ran")
      .catch((caught: unknown) => caught);

    expect(isBulkheadFullError(error)).toBe(true);
    expect(registry.bulkhead("api")).toBe(bulkhead);
  });

  test("caches nothing when one instance fails to build, so a later override still applies", () => {
    const registry = createRegistry((b) => b.configure("circuitBreaker", "api", { slidingWindow: { type: "count", size: 5 } }));

    const error = errorOf(() => registry.pipeline("api", { kinds: ["retry", "circuitBreaker"] }));

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('circuitBreaker "api"');
    expect(registry.retry("api", { maxAttempts: 2 }).name).toBe("api");
  });

  test("an override on an instance the pipeline created throws", () => {
    const registry = createRegistry();
    registry.pipeline("api", { kinds: ["timeout"] });

    const error = errorOf(() => registry.timeout("api", { durationMs: 10 }));

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('timeout "api"');
  });

  test("forwards the events of an instance the pipeline created", async () => {
    const registry = createRegistry((b) => b.configure("bulkhead", "api", { maxConcurrent: 1 }));
    const events: ResilienceEvent[] = [];
    registry.events.on((event) => events.push(event));
    const pipeline = registry.pipeline("api");
    void pipeline.execute(() => new Promise<never>(() => {}));

    await pipeline.execute(() => "ran").catch(() => undefined);

    expect(events.map(({ kind, name }) => [kind, name])).toEqual([["bulkhead-rejected", "api"]]);
  });

  test("is named after the name and is a new policy on every call", () => {
    const registry = createRegistry((b) => b.configure("retry", "api", {}).configure("timeout", "api", {}));

    const first = registry.pipeline("api");
    const second = registry.pipeline("api");

    expect(first.name).toBe("api");
    expect(second).not.toBe(first);
    expect(second.name).toBe("api");
  });
});
