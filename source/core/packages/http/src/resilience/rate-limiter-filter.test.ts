import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { createRateLimiter, isRateLimitExceededError } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import { Order } from "../filter";
import { rateLimiterFilter } from "./rate-limiter-filter";

const URL_A = "https://h.test/a";
const PERIOD_MS = 1000;

function setup(maxWaitMs: number) {
  const time = createManualTime(Date.parse("2026-11-16T12:00:00Z"));
  const policy = createRateLimiter("http", { limitForPeriod: 1, refreshPeriodMs: PERIOD_MS, maxWaitMs }, time);
  return { time, policy };
}

/** Hops real macrotasks until something is waiting on the manual timeline. */
async function untilSleeping(time: ManualTime): Promise<void> {
  for (let hops = 0; time.pendingSleeps === 0; hops++) {
    if (hops > 100) {
      throw new Error("nothing started waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("rateLimiterFilter", () => {
  test("is named rate-limiter at Order.RATE_LIMITER", () => {
    const built = rateLimiterFilter(setup(0).policy);

    expect(built.name).toBe("rate-limiter");
    expect(built.order).toBe(Order.RATE_LIMITER);
  });

  test("waits for the next permit, then sends", async () => {
    const { time, policy } = setup(PERIOD_MS);
    let calls = 0;
    const client = HttpClient.builder()
      .fetch(async () => {
        calls += 1;
        return new Response("ok");
      })
      .filter(rateLimiterFilter(policy))
      .build();

    await client.get(URL_A).send();
    const second = client.get(URL_A).text();
    await untilSleeping(time);
    expect(calls).toBe(1);
    await time.advance(PERIOD_MS);

    await expect(second).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  test("rejects with RateLimitExceededError when no permit comes in time, without calling fetch", async () => {
    const { policy } = setup(0);
    let calls = 0;
    const client = HttpClient.builder()
      .fetch(async () => {
        calls += 1;
        return new Response("ok");
      })
      .filter(rateLimiterFilter(policy))
      .build();

    await client.get(URL_A).send();
    const error = await client
      .get(URL_A)
      .send()
      .catch((caught: unknown) => caught);

    expect(isRateLimitExceededError(error)).toBe(true);
    expect(calls).toBe(1);
  });

  test("rejects with the caller's abort reason while waiting", async () => {
    const { time, policy } = setup(PERIOD_MS);
    const client = HttpClient.builder()
      .fetch(async () => new Response("ok"))
      .filter(rateLimiterFilter(policy))
      .build();
    const caller = new AbortController();
    const reason = new Error("gave up");

    await client.get(URL_A).send();
    const second = client.get(URL_A).signal(caller.signal).send();
    second.catch(() => {});
    await untilSleeping(time);
    caller.abort(reason);

    await expect(second).rejects.toBe(reason);
  });
});
