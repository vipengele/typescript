import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import {
  createRegistry,
  fixedBackoff,
  isCircuitOpenError,
  isResilienceConfigError,
  type ResilienceRegistry,
} from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import type { HttpFetch } from "../context";
import { isHttpConfigError, isHttpError } from "../errors/http-errors";
import { type Filter, filter, Order } from "../filter";
import { resilienceFilters } from "./resilience-filters";

const URL_A = "https://h.test/a";
const BACKOFF_MS = 100;
/** Far from the real time, so a Retry-After date measured with the system clock gives a different delay. */
const START = Date.parse("2040-01-01T00:00:00Z");

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

/** A fetch answering each call with the next response in `replies`, the last one repeating. */
function scriptedFetch(...replies: Array<() => Response>): { fetch: HttpFetch; calls: () => number } {
  let calls = 0;
  const fetch: HttpFetch = async () => {
    calls += 1;
    return (replies[Math.min(calls, replies.length) - 1] as () => Response)();
  };
  return { fetch, calls: () => calls };
}

function respond(status: number, headers?: HeadersInit): () => Response {
  return () => new Response(`body ${status}`, { status, headers });
}

/** Retry, circuit breaker and bulkhead called "api"; only the retry waits on the scheduler. */
function managedRegistry(time: ManualTime): ResilienceRegistry {
  return createRegistry((b) =>
    b
      .clock(time.clock)
      .scheduler(time.scheduler)
      .configure("retry", "api", { maxAttempts: 3, backoff: fixedBackoff(BACKOFF_MS) })
      .configure("circuitBreaker", "api", {})
      .configure("bulkhead", "api", { maxConcurrent: 4 }),
  );
}

/** Hops real macrotasks until a policy is waiting on the manual scheduler. */
async function untilSleeping(time: ManualTime): Promise<void> {
  for (let hops = 0; time.pendingSleeps === 0; hops++) {
    if (hops > 100) {
      throw new Error("nothing started waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A filter at `order` that counts the passes through it. */
function counter(name: string, order: number): { filter: Filter; count: () => number } {
  let count = 0;
  return {
    filter: filter({
      name,
      order,
      handle: (_ctx, next) => {
        count += 1;
        return next();
      },
    }),
    count: () => count,
  };
}

describe("resilienceFilters", () => {
  test("builds one filter per kind the registry configures for the name, in band order", () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) =>
      b
        .clock(time.clock)
        .scheduler(time.scheduler)
        .configure("bulkhead", "api", { maxConcurrent: 2 })
        .configure("timeout", "api", { durationMs: 500 })
        .configure("retry", "api", { maxAttempts: 2 }),
    );

    const filters = resilienceFilters(registry, "api");

    expect(filters.map((built) => built.name)).toEqual(["retry", "timeout", "bulkhead"]);
    expect(filters.map((built) => built.order)).toEqual([Order.RETRY, Order.TIMEOUT, Order.BULKHEAD]);
  });

  test("builds every kind an explicit kinds lists, in band order whatever order it lists them", () => {
    const registry = createRegistry();

    const filters = resilienceFilters(registry, "api", { kinds: ["bulkhead", "timeout", "rateLimiter", "circuitBreaker", "retry"] });

    expect(filters.map((built) => built.name)).toEqual(["retry", "circuit-breaker", "rate-limiter", "timeout", "bulkhead"]);
    expect(filters.map((built) => built.order)).toEqual([
      Order.RETRY,
      Order.CIRCUIT_BREAKER,
      Order.RATE_LIMITER,
      Order.TIMEOUT,
      Order.BULKHEAD,
    ]);
  });

  test("an explicit kinds builds only those kinds, ignoring others configured for the name", () => {
    const registry = createRegistry((b) => b.configure("retry", "api", {}).configure("timeout", "api", {}));

    expect(resilienceFilters(registry, "api", { kinds: ["timeout"] }).map((built) => built.name)).toEqual(["timeout"]);
  });

  test("creates the policies in the registry at the call", () => {
    const registry = createRegistry();

    resilienceFilters(registry, "api", { kinds: ["circuitBreaker", "bulkhead"] });

    expect(registry.kinds("api")).toEqual(["circuitBreaker", "bulkhead"]);
    expect(isResilienceConfigError(errorOf(() => registry.bulkhead("api", { maxConcurrent: 1 })))).toBe(true);
  });

  test("throws an HttpConfigError naming the name when no kind is configured or created for it", () => {
    const registry = createRegistry((b) => b.configure("retry", "other", {}).defaults("timeout", { durationMs: 100 }));

    const error = errorOf(() => resilienceFilters(registry, "orders"));

    expect(isHttpConfigError(error)).toBe(true);
    expect((error as Error).message).toContain('"orders"');
  });

  test("lets a ResilienceConfigError from creating a policy through unwrapped, keeping the policies created before it", () => {
    const registry = createRegistry((b) => b.configure("retry", "api", {}).configure("timeout", "api", { durationMs: -1 }));

    const error = errorOf(() => resilienceFilters(registry, "api"));

    expect(isResilienceConfigError(error)).toBe(true);
    expect(isHttpError(error)).toBe(false);
    expect((error as Error).message).toContain('timeout "api"');
    expect(isResilienceConfigError(errorOf(() => registry.retry("api", { maxAttempts: 2 })))).toBe(true);
  });

  test.each([
    ["an empty kinds", "api", []],
    ["a repeated kind", "api", ["retry", "retry"]],
    ["an unknown kind", "api", ["cache"]],
    ["an empty name", "", undefined],
  ] as const)("lets the registry's ResilienceConfigError for %s through unwrapped", (_, name, kinds) => {
    const registry = createRegistry();

    const error = errorOf(() => resilienceFilters(registry, name, kinds === undefined ? {} : { kinds: kinds as never }));

    expect(isResilienceConfigError(error)).toBe(true);
    expect(isHttpError(error)).toBe(false);
  });

  test("isFailure decides what the retry repeats", async () => {
    const time = createManualTime(START);
    const registry = managedRegistry(time);
    const isFailure = (outcome: { ok: boolean; value?: unknown }) => outcome.ok && (outcome.value as Response).status === 404;
    const { fetch, calls } = scriptedFetch(respond(404), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(...resilienceFilters(registry, "api", { kinds: ["retry"], isFailure }))
      .build();

    const pending = client.get(URL_A).text();
    await untilSleeping(time);
    await time.advance(BACKOFF_MS);

    await expect(pending).resolves.toBe("body 200");
    expect(calls()).toBe(2);
  });

  test("isFailure decides what counts against the circuit", async () => {
    const time = createManualTime(START);
    const registry = createRegistry((b) =>
      b.clock(time.clock).configure("circuitBreaker", "api", {
        failureRateThreshold: 50,
        slidingWindow: { type: "count", size: 2 },
        minimumCalls: 2,
        waitDurationInOpenMs: 10_000,
      }),
    );
    const { fetch, calls } = scriptedFetch(respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(...resilienceFilters(registry, "api", { isFailure: () => true }))
      .build();

    await client.get(URL_A).send();
    await client.get(URL_A).send();
    const error = await client
      .get(URL_A)
      .send()
      .catch((caught: unknown) => caught);

    expect(isCircuitOpenError(error)).toBe(true);
    expect(calls()).toBe(2);
  });

  test("clock measures an HTTP-date Retry-After for the retry", async () => {
    const time = createManualTime(START);
    const registry = managedRegistry(time);
    const retryAt = new Date(START + 3000).toUTCString();
    const { fetch, calls } = scriptedFetch(respond(503, { "Retry-After": retryAt }), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(...resilienceFilters(registry, "api", { kinds: ["retry"], clock: time.clock }))
      .build();

    const pending = client.get(URL_A).text();
    await untilSleeping(time);
    await time.advance(2999);
    expect(calls()).toBe(1);
    await time.advance(1);

    await expect(pending).resolves.toBe("body 200");
    expect(calls()).toBe(2);
  });

  test("a Retry-After past maxRetryAfterMs ends the retry at once", async () => {
    const time = createManualTime(START);
    const registry = managedRegistry(time);
    const { fetch, calls } = scriptedFetch(respond(503, { "Retry-After": "2" }), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(...resilienceFilters(registry, "api", { kinds: ["retry"], maxRetryAfterMs: 1000 }))
      .build();

    const response = await client.get(URL_A).send();

    expect(response.status).toBe(503);
    expect(calls()).toBe(1);
  });
});

describe("resilienceFilters end to end", () => {
  test("an observability filter runs once per call and an attempt filter once per attempt", async () => {
    const time = createManualTime(START);
    const registry = managedRegistry(time);
    const observability = counter("observe", Order.OBSERVABILITY);
    const attempt = counter("attempt", Order.ATTEMPT);
    const retryAt = new Date(START + 2000).toUTCString();
    const { fetch, calls } = scriptedFetch(respond(503, { "Retry-After": retryAt }), respond(502), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(observability.filter, attempt.filter)
      .resilience(registry, "api", { clock: time.clock })
      .build();

    const pending = client.get(URL_A).text();
    await untilSleeping(time);
    await time.advance(1999);
    expect(calls()).toBe(1);
    await time.advance(1);
    await untilSleeping(time);
    await time.advance(BACKOFF_MS);

    await expect(pending).resolves.toBe("body 200");
    expect(calls()).toBe(3);
    expect(observability.count()).toBe(1);
    expect(attempt.count()).toBe(3);
  });
});
