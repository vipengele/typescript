import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { createRetry, createTimeout, fixedBackoff, isOperationTimeoutError } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import { createRootContext, type HttpContext, type HttpFetch } from "../context";
import { filter, Order } from "../filter";
import { retryFilter } from "./retry-filter";
import { timeoutFilter } from "./timeout-filter";

const URL_A = "https://h.test/a";
const DURATION_MS = 1000;

function setup(): { time: ManualTime; policy: ReturnType<typeof createTimeout> } {
  const time = createManualTime(Date.parse("2026-11-16T12:00:00Z"));
  return { time, policy: createTimeout("http", { durationMs: DURATION_MS }, time) };
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

/** A fetch whose responses the test releases by hand, recording the signal of every call. */
function heldFetch(): { fetch: HttpFetch; signals: (AbortSignal | undefined)[]; release(response: Response): void } {
  const signals: (AbortSignal | undefined)[] = [];
  let release: (response: Response) => void = () => {};
  const fetch: HttpFetch = (_url, init) => {
    signals.push(init.signal ?? undefined);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  return { fetch, signals, release: (response) => release(response) };
}

/** A fetch that, like the platform's, rejects with the signal's reason once it aborts. */
function hangingFetch(signals: AbortSignal[]): HttpFetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

describe("timeoutFilter", () => {
  test("is named timeout at Order.TIMEOUT", () => {
    const built = timeoutFilter(setup().policy);

    expect(built.name).toBe("timeout");
    expect(built.order).toBe(Order.TIMEOUT);
    expect(built.allowsOrderTie).toBe(false);
  });

  test("hands fetch the policy's signal, composed with the caller's, and puts the caller's back after", async () => {
    const { policy } = setup();
    const caller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const contexts: HttpContext[] = [];
    const fetch: HttpFetch = async (_url, init) => {
      signals.push(init.signal ?? undefined);
      return new Response("ok");
    };
    const outer = filter({
      name: "outer",
      order: Order.OBSERVABILITY,
      handle: (ctx, next) => {
        contexts.push(ctx);
        return next();
      },
    });
    const client = HttpClient.builder().fetch(fetch).filter(outer, timeoutFilter(policy)).build();

    await expect(client.get(URL_A).signal(caller.signal).text()).resolves.toBe("ok");

    const sent = signals[0] as AbortSignal;
    expect(sent).toBeInstanceOf(AbortSignal);
    expect(sent).not.toBe(caller.signal);
    expect(contexts[0]?.request.signal).toBe(caller.signal);
    const reason = new Error("caller gave up");
    caller.abort(reason);
    expect(sent.aborted).toBe(true);
    expect(sent.reason).toBe(reason);
  });

  test("gives fetch a signal of its own when the caller sets none", async () => {
    const { policy } = setup();
    const signals: (AbortSignal | undefined)[] = [];
    const client = HttpClient.builder()
      .fetch(async (_url, init) => {
        signals.push(init.signal ?? undefined);
        return new Response("ok");
      })
      .filter(timeoutFilter(policy))
      .build();

    await client.get(URL_A).send();

    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });

  test("aborts fetch and rejects with the policy's OperationTimeoutError once the duration passes", async () => {
    const { time, policy } = setup();
    const signals: AbortSignal[] = [];
    const client = HttpClient.builder().fetch(hangingFetch(signals)).filter(timeoutFilter(policy)).build();

    const pending = client.get(URL_A).send();
    pending.catch(() => {});
    await untilSleeping(time);
    await time.advance(DURATION_MS);

    const error = await pending.catch((caught: unknown) => caught);
    expect(isOperationTimeoutError(error)).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toBe(error);
  });

  test("cancels the body of a response that arrives after the timeout", async () => {
    const { time, policy } = setup();
    const held = heldFetch();
    const client = HttpClient.builder().fetch(held.fetch).filter(timeoutFilter(policy)).build();

    const pending = client.get(URL_A).send();
    pending.catch(() => {});
    await untilSleeping(time);
    await time.advance(DURATION_MS);
    expect(isOperationTimeoutError(await pending.catch((caught: unknown) => caught))).toBe(true);

    const late = new Response("late");
    held.release(late);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(late.bodyUsed).toBe(true);
  });

  test("swallows the rejection of cancelling a late body that is locked", async () => {
    const { time, policy } = setup();
    const held = heldFetch();
    const client = HttpClient.builder().fetch(held.fetch).filter(timeoutFilter(policy)).build();

    const pending = client.get(URL_A).send();
    pending.catch(() => {});
    await untilSleeping(time);
    await time.advance(DURATION_MS);
    expect(isOperationTimeoutError(await pending.catch((caught: unknown) => caught))).toBe(true);

    const late = new Response("late");
    late.body?.getReader();
    held.release(late);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(late.body?.locked).toBe(true);
  });

  test("cancels the body of a response that arrives as the timeout fires", async () => {
    const { time, policy } = setup();
    const late = new Response("late");
    const ctx = createRootContext({ url: new URL(URL_A), method: "GET", headers: new Headers() }, async () => late);

    const pending = timeoutFilter(policy).handle(
      ctx,
      () =>
        new Promise((resolve) => {
          ctx.request.signal?.addEventListener("abort", () => resolve(late), { once: true });
        }),
    );
    pending.catch(() => {});
    await untilSleeping(time);
    await time.advance(DURATION_MS);

    expect(isOperationTimeoutError(await pending.catch((caught: unknown) => caught))).toBe(true);
    expect(late.bodyUsed).toBe(true);
    expect(ctx.request.signal).toBeUndefined();
  });

  test("leaves the body of a response that arrives in time readable", async () => {
    const { time, policy } = setup();
    const held = heldFetch();
    const client = HttpClient.builder().fetch(held.fetch).filter(timeoutFilter(policy)).build();

    const pending = client.get(URL_A).send();
    await untilSleeping(time);
    await time.advance(DURATION_MS - 1);
    held.release(new Response("in time"));

    const response = await pending;
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe("in time");
    expect(time.pendingSleeps).toBe(0);
  });

  test("behind a retry, times out each attempt on its own signal", async () => {
    const time = createManualTime(Date.parse("2026-11-16T12:00:00Z"));
    const timeout = createTimeout("http", { durationMs: DURATION_MS }, time);
    const retry = createRetry("http", { maxAttempts: 2, backoff: fixedBackoff(100) }, time);
    const signals: AbortSignal[] = [];
    const hanging = hangingFetch(signals);
    let calls = 0;
    const fetch: HttpFetch = (url, init) => {
      calls += 1;
      if (calls === 1) {
        return hanging(url, init);
      }
      signals.push(init.signal as AbortSignal);
      return Promise.resolve(new Response("second"));
    };
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(retry), timeoutFilter(timeout)).build();

    const pending = client.get(URL_A).text();
    await untilSleeping(time);
    await time.advance(DURATION_MS);
    await untilSleeping(time);
    await time.advance(100);

    await expect(pending).resolves.toBe("second");
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(isOperationTimeoutError(signals[0]?.reason)).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
