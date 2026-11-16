import { createManualTime } from "@vipengele/ts-core-common/testing";
import { createCircuitBreaker, isCircuitOpenError } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import type { HttpContext, HttpFetch } from "../context";
import { filter, Order } from "../filter";
import { circuitBreakerFilter } from "./circuit-breaker-filter";
import { HttpResilienceAttributes } from "./predicates";

const URL_A = "https://h.test/a";

function setup() {
  const time = createManualTime(Date.parse("2026-11-16T12:00:00Z"));
  const policy = createCircuitBreaker(
    "http",
    {
      failureRateThreshold: 50,
      slidingWindow: { type: "count", size: 2 },
      minimumCalls: 2,
      waitDurationInOpenMs: 10_000,
      permittedCallsInHalfOpen: 1,
    },
    { clock: time.clock },
  );
  return { time, policy };
}

/** Builds a client around `fetch` and `circuitBreaker`, collecting the root context of each call. */
function clientFor(fetch: HttpFetch, circuitBreaker: ReturnType<typeof circuitBreakerFilter>) {
  const contexts: HttpContext[] = [];
  const outer = filter({
    name: "outer",
    order: Order.OBSERVABILITY,
    handle: (ctx, next) => {
      contexts.push(ctx);
      return next();
    },
  });
  return { client: HttpClient.builder().fetch(fetch).filter(outer, circuitBreaker).build(), contexts };
}

describe("circuitBreakerFilter", () => {
  test("is named circuit-breaker at Order.CIRCUIT_BREAKER", () => {
    const built = circuitBreakerFilter(setup().policy);

    expect(built.name).toBe("circuit-breaker");
    expect(built.order).toBe(Order.CIRCUIT_BREAKER);
  });

  test("opens on 5xx responses, returning each, then refuses without calling fetch", async () => {
    const { policy } = setup();
    let calls = 0;
    const fetch: HttpFetch = async () => {
      calls += 1;
      return new Response("down", { status: 503 });
    };
    const { client } = clientFor(fetch, circuitBreakerFilter(policy));

    expect((await client.get(URL_A).send()).status).toBe(503);
    expect((await client.get(URL_A).send()).status).toBe(503);
    const error = await client
      .get(URL_A)
      .send()
      .catch((caught: unknown) => caught);

    expect(isCircuitOpenError(error)).toBe(true);
    expect(calls).toBe(2);
    expect(policy.state).toBe("open");
  });

  test("records the circuit state after a call settles", async () => {
    const { policy } = setup();
    const { client, contexts } = clientFor(async () => new Response("ok"), circuitBreakerFilter(policy));

    await client.get(URL_A).send();

    expect(contexts[0]?.attributes.get(HttpResilienceAttributes.circuitState)).toBe("closed");
  });

  test("records the circuit state after a refusal", async () => {
    const { policy } = setup();
    policy.forceOpen();
    let calls = 0;
    const { client, contexts } = clientFor(async () => {
      calls += 1;
      return new Response("ok");
    }, circuitBreakerFilter(policy));

    const error = await client
      .get(URL_A)
      .send()
      .catch((caught: unknown) => caught);

    expect(isCircuitOpenError(error)).toBe(true);
    expect(calls).toBe(0);
    expect(contexts[0]?.attributes.get(HttpResilienceAttributes.circuitState)).toBe("forced-open");
  });

  test("counts a thrown error as a failure", async () => {
    const { policy } = setup();
    const { client } = clientFor(async () => {
      throw new TypeError("network");
    }, circuitBreakerFilter(policy));

    await client
      .get(URL_A)
      .send()
      .catch(() => {});
    await client
      .get(URL_A)
      .send()
      .catch(() => {});

    expect(policy.state).toBe("open");
  });

  test("lets a custom isFailure decide what counts", async () => {
    const { policy } = setup();
    const seen: unknown[] = [];
    const lenient = circuitBreakerFilter(policy, {
      isFailure: (outcome) => {
        seen.push(outcome);
        return false;
      },
    });
    const { client } = clientFor(async () => new Response("down", { status: 503 }), lenient);

    await client.get(URL_A).send();
    await client.get(URL_A).send();
    await client.get(URL_A).send();

    expect(policy.state).toBe("closed");
    expect(seen).toHaveLength(3);
  });
});
