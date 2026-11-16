import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { createRetry, fixedBackoff } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import { createRootContext, type HttpContext, type HttpFetch } from "../context";
import { isHttpStatusError } from "../errors/http-errors";
import { type Filter, filter, Order } from "../filter";
import { HttpResilienceAttributes, RetryNonIdempotent } from "./predicates";
import { retryFilter } from "./retry-filter";

const URL_A = "https://h.test/a";
const BACKOFF_MS = 100;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

type Reply = Response | Error | ((init: RequestInit) => Promise<Response>);

/** A fetch answering each call with the next reply in `replies`, the last one repeating. */
function scriptedFetch(...replies: Reply[]): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    if (reply instanceof Error) {
      throw reply;
    }
    if (typeof reply === "function") {
      return reply(init);
    }
    return reply as Response;
  };
  return { fetch, calls };
}

function respond(status: number, headers?: HeadersInit): Response {
  return new Response(`body ${status}`, { status, headers });
}

function setup(maxAttempts = 3): { time: ManualTime; policy: ReturnType<typeof createRetry> } {
  const time = createManualTime(Date.parse("2026-11-16T12:00:00Z"));
  const policy = createRetry("http", { maxAttempts, backoff: fixedBackoff(BACKOFF_MS) }, time);
  return { time, policy };
}

/** Hops real macrotasks until the retry is waiting between attempts. */
async function untilSleeping(time: ManualTime): Promise<void> {
  for (let hops = 0; time.pendingSleeps === 0; hops++) {
    if (hops > 100) {
      throw new Error("the retry never started waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Advances through `waits` backoff waits, each once the retry has started it. */
async function runWaits(time: ManualTime, waits: number, ms = BACKOFF_MS): Promise<void> {
  for (let wait = 0; wait < waits; wait++) {
    await untilSleeping(time);
    await time.advance(ms);
  }
}

/** A filter at `order` that hands every context it sees to `seen`. */
function capture(name: string, order: number, seen: HttpContext[]): Filter {
  return filter({
    name,
    order,
    handle: (ctx, next) => {
      seen.push(ctx);
      return next();
    },
  });
}

describe("retryFilter", () => {
  test("is named retry at Order.RETRY", () => {
    const { policy } = setup();
    const built = retryFilter(policy);

    expect(built.name).toBe("retry");
    expect(built.order).toBe(Order.RETRY);
    expect(built.allowsOrderTie).toBe(false);
  });

  test("retries a failure and returns the response that succeeds", async () => {
    const { time, policy } = setup();
    const { fetch, calls } = scriptedFetch(new TypeError("network down"), respond(503), respond(200));
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const pending = client.get(URL_A).text();
    await runWaits(time, 2);

    await expect(pending).resolves.toBe("body 200");
    expect(calls).toHaveLength(3);
  });

  test("rethrows the last error once the attempts run out", async () => {
    const { time, policy } = setup();
    const last = new TypeError("third");
    const { fetch, calls } = scriptedFetch(new TypeError("first"), new TypeError("second"), last);
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const pending = client.get(URL_A).send();
    pending.catch(() => {});
    await runWaits(time, 2);

    await expect(pending).rejects.toBe(last);
    expect(calls).toHaveLength(3);
  });

  test("returns the last response on a failing status, for the conversion after the chain", async () => {
    const { time, policy } = setup();
    const responses = [respond(503), respond(502), respond(500)];
    const { fetch } = scriptedFetch(...responses);
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const sent = client.get(URL_A).send();
    await runWaits(time, 2);
    const response = await sent;
    expect(response).toBe(responses[2]);
    expect(response.status).toBe(500);

    const { fetch: again } = scriptedFetch(respond(503));
    const converting = HttpClient.builder().fetch(again).filter(retryFilter(policy)).build().get(URL_A).text();
    converting.catch(() => {});
    await runWaits(time, 2);
    const error = await converting.catch((caught: unknown) => caught);
    expect(isHttpStatusError(error)).toBe(true);
  });

  test("runs every attempt on a fresh context built from the received one, attempt 1 to n", async () => {
    const { time, policy } = setup();
    const outer: HttpContext[] = [];
    const inner: HttpContext[] = [];
    const { fetch } = scriptedFetch(respond(503), respond(503), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(capture("outer", Order.OBSERVABILITY, outer), retryFilter(policy), capture("inner", Order.ATTEMPT, inner))
      .build();

    const pending = client.get(URL_A).send();
    await runWaits(time, 2);
    await pending;

    const base = outer[0] as HttpContext;
    expect(inner.map((ctx) => ctx.attempt)).toEqual([1, 2, 3]);
    expect(new Set(inner).size).toBe(3);
    for (const ctx of inner) {
      expect(ctx).not.toBe(base);
      expect(ctx.request).not.toBe(base.request);
      expect(ctx.request.url.href).toBe(base.request.url.href);
      expect(ctx.attributes).toBe(base.attributes);
      expect(ctx.fetch).toBe(base.fetch);
    }
  });

  test("a header set by an attempt-order filter does not reach the next attempt", async () => {
    const { time, policy } = setup();
    const { fetch, calls } = scriptedFetch(respond(503), respond(200));
    const seenBefore: (string | null)[] = [];
    const stamping = filter({
      name: "stamp",
      order: Order.ATTEMPT,
      handle: (ctx, next) => {
        seenBefore.push(ctx.request.headers.get("x-stamp"));
        ctx.request.headers.append("x-stamp", String(ctx.attempt));
        ctx.request.url.searchParams.set("attempt", String(ctx.attempt));
        return next();
      },
    });
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy), stamping).build();

    const pending = client.get(URL_A).send();
    await runWaits(time, 1);
    await pending;

    expect(seenBefore).toEqual([null, null]);
    expect(calls.map((call) => new Headers(call.init.headers).get("x-stamp"))).toEqual(["1", "2"]);
    expect(calls.map((call) => call.url)).toEqual([`${URL_A}?attempt=1`, `${URL_A}?attempt=2`]);
  });

  test("cancels every discarded body and leaves the returned one readable", async () => {
    const { time, policy } = setup();
    const responses = [respond(503), respond(503), respond(200)];
    const { fetch } = scriptedFetch(...responses);
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const pending = client.get(URL_A).send();
    await runWaits(time, 2);
    const response = await pending;

    expect(responses[0]?.bodyUsed).toBe(true);
    expect(responses[1]?.bodyUsed).toBe(true);
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe("body 200");
  });

  test("swallows the rejection of cancelling a body that is locked", async () => {
    const { time, policy } = setup();
    const locked = respond(503);
    locked.body?.getReader();
    const { fetch } = scriptedFetch(locked, respond(200));
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const pending = client.get(URL_A).text();
    await runWaits(time, 1);

    await expect(pending).resolves.toBe("body 200");
    expect(locked.body?.locked).toBe(true);
  });

  test("a caller abort during the wait rejects with its reason and cancels the held body", async () => {
    const { time, policy } = setup();
    const held = respond(503);
    const { fetch, calls } = scriptedFetch(held, respond(200));
    const controller = new AbortController();
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    const pending = client.get(URL_A).signal(controller.signal).send();
    pending.catch(() => {});
    await untilSleeping(time);
    const reason = new Error("caller gave up");
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(held.bodyUsed).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("never cancels anything when the caller's signal is aborted before the first attempt", async () => {
    const { policy } = setup();
    const { fetch, calls } = scriptedFetch(respond(200));
    const seen: HttpContext[] = [];
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(capture("outer", Order.OBSERVABILITY, seen), retryFilter(policy))
      .build();
    const reason = new Error("already aborted");

    await expect(client.get(URL_A).signal(AbortSignal.abort(reason)).send()).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
    expect(seen[0]?.attributes.get(HttpResilienceAttributes.attempts)).toBe(0);
  });

  test("sends a stream body once and does not retry it", async () => {
    const { policy } = setup();
    const { fetch, calls } = scriptedFetch(respond(503));
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("once"));
        controller.close();
      },
    });

    const response = await client.put(URL_A).body(stream).send();

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  test("does not retry a POST unless the call opts in", async () => {
    const { time, policy } = setup();
    const { fetch, calls } = scriptedFetch(respond(503), respond(503), respond(200));
    const client = HttpClient.builder().fetch(fetch).filter(retryFilter(policy)).build();

    expect((await client.post(URL_A).body("x").send()).status).toBe(503);
    expect(calls).toHaveLength(1);

    const pending = client.post(URL_A).body("x").attribute(RetryNonIdempotent, true).send();
    await runWaits(time, 1);
    expect((await pending).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  test("waits the Retry-After delay in place of the backoff", async () => {
    const { time, policy } = setup();
    const { fetch, calls } = scriptedFetch(respond(503, { "Retry-After": "2" }), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(retryFilter(policy, { clock: time.clock }))
      .build();

    const pending = client.get(URL_A).send();
    await untilSleeping(time);
    await time.advance(BACKOFF_MS);
    expect(calls).toHaveLength(1);
    await time.advance(2000 - BACKOFF_MS);

    expect((await pending).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("returns the response whose Retry-After exceeds the cap, without waiting", async () => {
    const { policy } = setup();
    const capped = respond(429, { "Retry-After": "5" });
    const { fetch, calls } = scriptedFetch(capped, respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(retryFilter(policy, { maxRetryAfterMs: 1000 }))
      .build();

    const response = await client.get(URL_A).send();

    expect(response).toBe(capped);
    expect(response.bodyUsed).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("records the attempts made on the shared attributes, on success and on failure", async () => {
    const { time, policy } = setup();
    const seen: HttpContext[] = [];
    const { fetch } = scriptedFetch(respond(503), respond(200));
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(capture("outer", Order.OBSERVABILITY, seen), retryFilter(policy))
      .build();

    const succeeding = client.get(URL_A).send();
    await runWaits(time, 1);
    await succeeding;
    expect(seen[0]?.attributes.get(HttpResilienceAttributes.attempts)).toBe(2);

    const { fetch: failing } = scriptedFetch(new TypeError("down"));
    const failingClient = HttpClient.builder()
      .fetch(failing)
      .filter(capture("outer", Order.OBSERVABILITY, seen), retryFilter(policy))
      .build();
    const rejected = failingClient.get(URL_A).send();
    rejected.catch(() => {});
    await runWaits(time, 2);
    await expect(rejected).rejects.toThrow("down");
    expect(seen[1]?.attributes.get(HttpResilienceAttributes.attempts)).toBe(3);
  });

  test("runs directly on a hand-made context, leaving it untouched", async () => {
    const { time, policy } = setup();
    const root = createRootContext({ url: new URL(URL_A), method: "GET", headers: new Headers() }, async () => respond(200));
    const attributes = new Map<string | symbol, unknown>();
    const base: HttpContext = {
      request: root.request,
      attributes,
      attempt: 9,
      fetch: root.fetch,
      replayable: true,
      fork: () => root.fork(),
    };
    const attempts: number[] = [];
    let replies = 0;

    const pending = retryFilter(policy).handle(base, async (ctx) => {
      attempts.push(ctx?.attempt ?? 0);
      ctx?.request.headers.set("x-touched", "yes");
      replies += 1;
      return replies === 1 ? respond(503) : respond(200);
    });
    await runWaits(time, 1);

    expect((await pending).status).toBe(200);
    expect(attempts).toEqual([1, 2]);
    expect(base.request.headers.has("x-touched")).toBe(false);
    expect(attributes.get(HttpResilienceAttributes.attempts)).toBe(2);
  });
});
