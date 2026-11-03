import { fixedBackoff } from "@vipengele/ts-core-resilience/retry";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import type { Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createDelivery,
  type DeliveryEntry,
  type DeliveryOptions,
  type DeliveryRequest,
  type DeliveryResponse,
  type DropReason,
} from "./delivery";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
});

type Responder = (init: DeliveryRequest) => Promise<DeliveryResponse> | DeliveryResponse;

function status(code: number, headers: Record<string, string> = {}): DeliveryResponse {
  return new Response(null, { status: code, headers });
}

/** Never settles on its own; rejects with the signal's reason once the attempt is aborted. */
function hang(init: DeliveryRequest): Promise<DeliveryResponse> {
  return new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
}

/** A fetch that answers each call with the next responder, then with 200. */
function fakeFetch(...responders: Responder[]) {
  const calls: { url: string; init: DeliveryRequest; at: number }[] = [];
  let now: () => number = () => 0;
  const fetch = (url: string, init: DeliveryRequest): Promise<DeliveryResponse> => {
    calls.push({ url, init, at: now() });
    const responder = responders.shift();
    return Promise.resolve(responder === undefined ? status(200) : responder(init));
  };
  return {
    fetch,
    calls,
    useClock(clock: () => number) {
      now = clock;
    },
  };
}

/** Lets every pending continuation run. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Harness {
  readonly time: ManualTime;
  readonly drops: [DropReason, number][];
  readonly calls: ReturnType<typeof fakeFetch>["calls"];
  readonly encoded: ReadonlyArray<DeliveryEntry<string>>[];
  readonly delivery: ReturnType<typeof createDelivery<string>>;
}

function harness(responders: Responder[] = [], overrides: Partial<DeliveryOptions<string>> = {}, start = 0): Harness {
  const time = createManualTime(start);
  const fake = fakeFetch(...responders);
  fake.useClock(time.clock);
  const drops: [DropReason, number][] = [];
  const encoded: ReadonlyArray<DeliveryEntry<string>>[] = [];
  const delivery = createDelivery<string>({
    url: "https://collector.example/v1/logs",
    fetch: fake.fetch,
    clock: time.clock,
    scheduler: time.scheduler,
    backoff: fixedBackoff(1000),
    encode: (entries) => {
      encoded.push(entries);
      return JSON.stringify(entries.map((entry) => entry.item));
    },
    onDrop: (reason, count) => {
      drops.push([reason, count]);
    },
    ...overrides,
  });
  return { time, drops, calls: fake.calls, encoded, delivery };
}

function enqueueAll(delivery: Harness["delivery"], items: string[]): void {
  for (const item of items) {
    delivery.enqueue(item, RESOURCE);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDelivery triggers", () => {
  test("exports at once when the buffer reaches maxBatchSize", async () => {
    const { delivery, calls, encoded, drops, time } = harness(
      [],
      { headers: { authorization: "Bearer t" }, limits: { maxBatchSize: 3 } },
      500,
    );
    enqueueAll(delivery, ["a", "b"]);
    await tick();
    expect(calls).toHaveLength(0);
    delivery.enqueue("c", RESOURCE);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://collector.example/v1/logs");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: '["a","b","c"]',
    });
    expect(encoded[0]).toEqual([
      { item: "a", resource: RESOURCE, observedMs: 500 },
      { item: "b", resource: RESOURCE, observedMs: 500 },
      { item: "c", resource: RESOURCE, observedMs: 500 },
    ]);
    expect(drops).toEqual([]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("exports scheduleDelayMs after the first entry reaches an empty buffer", async () => {
    const { delivery, calls, time } = harness();
    delivery.enqueue("a", RESOURCE);
    await time.advance(3000);
    delivery.enqueue("b", RESOURCE);
    await time.advance(1999);
    expect(calls).toHaveLength(0);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.body).toBe('["a","b"]');
    expect(time.pendingSleeps).toBe(0);
  });

  test("a delay sleep that resolved before its timer was replaced does not export the remainder early", async () => {
    const time = createManualTime(0);
    let wake: () => void = () => {};
    let first = true;
    const scheduler: Scheduler = {
      sleep(ms, signal) {
        if (!first) {
          return time.scheduler.sleep(ms, signal);
        }
        first = false;
        return new Promise((resolve) => {
          wake = resolve;
        });
      },
    };
    const { delivery, calls } = harness([], { limits: { maxBatchSize: 2 }, scheduler, clock: time.clock });
    delivery.enqueue("a", RESOURCE);
    wake();
    delivery.enqueue("b", RESOURCE);
    delivery.enqueue("c", RESOURCE);
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]']);
    await time.advance(4999);
    expect(calls).toHaveLength(1);
    await time.advance(1);
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]', '["c"]']);
  });

  test("exports a full batch left in the buffer as soon as the batch in flight settles", async () => {
    let release: (response: DeliveryResponse) => void = () => {};
    const first: Responder = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { delivery, calls, time } = harness([first], { limits: { maxBatchSize: 2 } });
    enqueueAll(delivery, ["a", "b", "c", "d", "e"]);
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]']);
    release(status(200));
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]', '["c","d"]']);
    await time.advance(4999);
    expect(calls).toHaveLength(2);
    await time.advance(1);
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]', '["c","d"]', '["e"]']);
  });

  test("exports an entry left behind by an export scheduleDelayMs after its own enqueue", async () => {
    let release: (response: DeliveryResponse) => void = () => {};
    const first: Responder = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { delivery, calls, time, encoded } = harness([first], { limits: { maxBatchSize: 2, attemptTimeoutMs: 60_000 } });
    enqueueAll(delivery, ["a", "b"]);
    await time.advance(1000);
    enqueueAll(delivery, ["c", "d", "e"]);
    await time.advance(1000);
    release(status(200));
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]', '["c","d"]']);
    await time.advance(3999);
    expect(calls).toHaveLength(2);
    await time.advance(1);
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]', '["c","d"]', '["e"]']);
    expect(calls[2]?.at).toBe((encoded[2]?.[0]?.observedMs ?? Number.NaN) + 5000);
  });

  test("exports a batch whose delay elapsed while another was in flight once that one settles", async () => {
    let release: (response: DeliveryResponse) => void = () => {};
    const first: Responder = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { delivery, calls, time } = harness([first], { limits: { maxBatchSize: 1, attemptTimeoutMs: 60_000 } });
    enqueueAll(delivery, ["a", "b"]);
    await time.advance(5000);
    expect(calls).toHaveLength(1);
    release(status(200));
    await tick();
    expect(calls.map((call) => call.init.body)).toEqual(['["a"]', '["b"]']);
  });

  test("reads a headers thunk once per batch", async () => {
    let reads = 0;
    const headers = () => {
      reads += 1;
      return { "x-read": String(reads) };
    };
    const { delivery, calls } = harness([], { headers, limits: { maxBatchSize: 1 } });
    enqueueAll(delivery, ["a", "b"]);
    await tick();
    await tick();
    expect(calls.map((call) => call.init.headers["x-read"])).toEqual(["1", "2"]);
  });
});

describe("createDelivery drops", () => {
  test("drops the newest entry as queue-full once the buffer holds maxQueueSize", async () => {
    const { delivery, drops, calls } = harness([], { limits: { maxQueueSize: 2, maxBatchSize: 10 } });
    enqueueAll(delivery, ["a", "b", "c"]);
    expect(drops).toEqual([["queue-full", 1]]);
    await delivery.flush();
    expect(calls[0]?.init.body).toBe('["a","b"]');
  });

  test("does not count the batch in flight toward maxQueueSize", async () => {
    const { delivery, drops } = harness([hang], { limits: { maxQueueSize: 2, maxBatchSize: 2 } });
    enqueueAll(delivery, ["a", "b"]);
    await tick();
    enqueueAll(delivery, ["c", "d"]);
    expect(drops).toEqual([]);
    delivery.enqueue("e", RESOURCE);
    expect(drops).toEqual([["queue-full", 1]]);
  });

  test("drops a batch the collector refuses with a status it does not retry as rejected", async () => {
    const { delivery, drops, calls } = harness([() => status(400)], { limits: { maxBatchSize: 2 } });
    enqueueAll(delivery, ["a", "b"]);
    await tick();
    expect(calls).toHaveLength(1);
    expect(drops).toEqual([["rejected", 2]]);
  });

  test("drops the batch as rejected when encode throws", async () => {
    const encode = () => {
      throw new Error("cannot encode");
    };
    const { delivery, drops, calls } = harness([], { encode, limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([["rejected", 1]]);
  });

  test("drops the batch as rejected when the headers thunk throws", async () => {
    const headers = (): Record<string, string> => {
      throw new Error("no token");
    };
    const { delivery, drops, calls } = harness([], { headers, limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([["rejected", 1]]);
  });

  test("drops the batch as rejected, without retrying, when fetch throws synchronously", async () => {
    let calls = 0;
    const fetch = () => {
      calls += 1;
      throw new TypeError("fetch is not available");
    };
    const { delivery, drops } = harness([], { fetch, limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls).toBe(1);
    expect(drops).toEqual([["rejected", 1]]);
  });

  test("keeps a throwing onDrop from escaping", async () => {
    const onDrop = () => {
      throw new Error("observer failed");
    };
    const { delivery } = harness([() => status(400)], { onDrop, limits: { maxQueueSize: 1, maxBatchSize: 1 } });
    expect(() => enqueueAll(delivery, ["a", "b", "c"])).not.toThrow();
    await expect(delivery.flush()).resolves.toBe(true);
  });
});

describe("createDelivery retries", () => {
  test.each([429, 502, 503, 504])("retries status %i after the backoff", async (code) => {
    const { delivery, drops, calls, time } = harness([() => status(code)], { limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls).toHaveLength(1);
    await time.advance(999);
    expect(calls).toHaveLength(1);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([]);
  });

  test("retries a network error", async () => {
    const { delivery, drops, calls, time } = harness([() => Promise.reject(new TypeError("network down"))], {
      limits: { maxBatchSize: 1 },
    });
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(1000);
    await tick();
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([]);
  });

  test("abandons an attempt that outlives attemptTimeoutMs and retries it", async () => {
    const { delivery, drops, calls, time } = harness([hang], { limits: { maxBatchSize: 1, attemptTimeoutMs: 500 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls[0]?.init.signal.aborted).toBe(false);
    await time.advance(500);
    expect(calls[0]?.init.signal.aborted).toBe(true);
    await time.advance(1000);
    await tick();
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([]);
  });

  test("waits the delta-seconds a Retry-After names instead of the backoff", async () => {
    const { delivery, calls, time } = harness([() => status(503, { "retry-after": "7" })], { limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(6999);
    expect(calls).toHaveLength(1);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at).toBe(7000);
  });

  test("waits until the HTTP-date a Retry-After names, read against the clock", async () => {
    const start = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    const { delivery, calls, time } = harness(
      [() => status(429, { "retry-after": "Wed, 21 Oct 2026 07:28:03 GMT" })],
      { limits: { maxBatchSize: 1 } },
      start,
    );
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(2999);
    expect(calls).toHaveLength(1);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at).toBe(start + 3000);
  });

  test("drops the batch as retries-exhausted after maxAttempts retryable statuses", async () => {
    const always503: Responder = () => status(503);
    const { delivery, drops, calls, time } = harness([always503, always503, always503], { limits: { maxBatchSize: 2, maxAttempts: 3 } });
    enqueueAll(delivery, ["a", "b"]);
    await tick();
    await time.advance(2000);
    await tick();
    expect(calls).toHaveLength(3);
    expect(drops).toEqual([["retries-exhausted", 2]]);
  });

  test("drops the batch as retries-exhausted after maxAttempts network errors", async () => {
    const down: Responder = () => Promise.reject(new TypeError("network down"));
    const { delivery, drops, calls, time } = harness([down, down], { limits: { maxBatchSize: 1, maxAttempts: 2 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(1000);
    await tick();
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([["retries-exhausted", 1]]);
  });

  test("backs off with full-jitter exponential backoff when none is given", async () => {
    const { delivery, drops, calls, time } = harness([() => status(503)], { backoff: undefined, limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(1000);
    await tick();
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([]);
  });

  test("cancels a response body nobody reads", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("already locked")));
    const withBody: Responder = () => ({ status: 200, headers: new Headers(), body: { cancel } });
    const { delivery, drops } = harness([withBody, () => new Response("ok")], { limits: { maxBatchSize: 1 } });
    enqueueAll(delivery, ["a", "b"]);
    await delivery.flush();
    expect(cancel).toHaveBeenCalledOnce();
    expect(drops).toEqual([]);
  });
});

describe("createDelivery flush", () => {
  test("resolves true at once when nothing is pending", async () => {
    const { delivery } = harness();
    await expect(delivery.flush()).resolves.toBe(true);
  });

  test("exports the buffer without waiting for the schedule delay", async () => {
    const { delivery, calls, time } = harness();
    enqueueAll(delivery, ["a", "b"]);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(calls.map((call) => call.init.body)).toEqual(['["a","b"]']);
    expect(time.pendingSleeps).toBe(0);
  });

  test("cuts a backoff short so the next attempt starts at once", async () => {
    const { delivery, calls, drops, time } = harness([() => status(503)], { backoff: fixedBackoff(60_000), limits: { maxBatchSize: 1 } });
    delivery.enqueue("a", RESOURCE);
    await tick();
    expect(calls).toHaveLength(1);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(time.clock()).toBe(0);
    expect(drops).toEqual([]);
  });

  test("skips every backoff while it waits", async () => {
    const always503: Responder = () => status(503);
    const { delivery, calls, drops } = harness([always503, always503, always503], {
      backoff: fixedBackoff(60_000),
      limits: { maxAttempts: 3 },
    });
    delivery.enqueue("a", RESOURCE);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(3);
    expect(drops).toEqual([["retries-exhausted", 1]]);
  });

  test("restores the backoff once it returns", async () => {
    const { delivery, calls, time } = harness([() => status(503)], { limits: { maxBatchSize: 1 } });
    await delivery.flush();
    delivery.enqueue("a", RESOURCE);
    await tick();
    await time.advance(999);
    expect(calls).toHaveLength(1);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(2);
  });

  test("resolves false when timeoutMs elapses first, and keeps the batch", async () => {
    let release: (response: DeliveryResponse) => void = () => {};
    const slow: Responder = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const { delivery, drops, time } = harness([slow]);
    delivery.enqueue("a", RESOURCE);
    const flushed = delivery.flush(100);
    await time.advance(100);
    await expect(flushed).resolves.toBe(false);
    release(status(200));
    await tick();
    expect(drops).toEqual([]);
    await expect(delivery.flush()).resolves.toBe(true);
  });

  test("waits flushTimeoutMs when no timeout is given", async () => {
    const { delivery, time } = harness([hang], { limits: { flushTimeoutMs: 300, attemptTimeoutMs: 60_000 } });
    delivery.enqueue("a", RESOURCE);
    let result: boolean | undefined;
    void delivery.flush().then((value) => {
      result = value;
    });
    await time.advance(299);
    expect(result).toBeUndefined();
    await time.advance(1);
    await tick();
    expect(result).toBe(false);
  });
});

describe("createDelivery close", () => {
  test("resolves true and drops nothing when everything is delivered", async () => {
    const { delivery, calls, drops, time } = harness();
    enqueueAll(delivery, ["a", "b"]);
    await expect(delivery.close()).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(drops).toEqual([]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("drops the batch in flight and the buffer as closed when timeoutMs elapses", async () => {
    const { delivery, calls, drops, time } = harness([hang], { limits: { maxBatchSize: 2, attemptTimeoutMs: 60_000 } });
    enqueueAll(delivery, ["a", "b", "c"]);
    await tick();
    const closed = delivery.close(100);
    await time.advance(100);
    await expect(closed).resolves.toBe(false);
    expect(calls[0]?.init.signal.aborted).toBe(true);
    await tick();
    expect(drops).toEqual([
      ["closed", 1],
      ["closed", 2],
    ]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("drops only the batch in flight when the buffer is empty", async () => {
    const { delivery, drops, time } = harness([hang], { limits: { maxBatchSize: 1, attemptTimeoutMs: 60_000 } });
    delivery.enqueue("a", RESOURCE);
    const closed = delivery.close(100);
    await time.advance(100);
    await expect(closed).resolves.toBe(false);
    await tick();
    expect(drops).toEqual([["closed", 1]]);
  });

  test("turns later enqueue and flush into no-ops, and returns the same promise when called twice", async () => {
    const { delivery, calls, drops } = harness();
    const closed = delivery.close();
    expect(delivery.close()).toBe(closed);
    await expect(closed).resolves.toBe(true);
    delivery.enqueue("late", RESOURCE);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(delivery.flush()).toBe(closed);
    await tick();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([]);
  });
});

describe("createDelivery undefined limits", () => {
  const undefinedLimits = {
    maxQueueSize: undefined,
    maxBatchSize: undefined,
    scheduleDelayMs: undefined,
    maxAttempts: undefined,
    attemptTimeoutMs: undefined,
    flushTimeoutMs: undefined,
  } as unknown as DeliveryOptions<string>["limits"];

  test("an undefined limit means the default: the timer export fires at 5000ms", async () => {
    const { delivery, calls, time } = harness([], { limits: undefinedLimits });
    delivery.enqueue("a", RESOURCE);
    await time.advance(4999);
    expect(calls).toHaveLength(0);
    await time.advance(1);
    await tick();
    expect(calls).toHaveLength(1);
  });

  test("an undefined limit means the default: flush drains", async () => {
    const { delivery, calls } = harness([], { limits: undefinedLimits });
    delivery.enqueue("a", RESOURCE);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("createDelivery configuration", () => {
  test.each([
    ["maxQueueSize", 0],
    ["maxBatchSize", 1.5],
  ])("throws a RangeError for %s %d", (name, value) => {
    expect(() => createDelivery({ url: "https://collector.example", encode: () => "", limits: { [name]: value } })).toThrow(RangeError);
  });

  test("sends through globalThis.fetch with the system clock and scheduler by default", async () => {
    const fetch = vi.fn((_url: string, _init: DeliveryRequest) => Promise.resolve(status(204)));
    vi.stubGlobal("fetch", fetch);
    const drops: DropReason[] = [];
    const delivery = createDelivery<string>({
      url: "https://collector.example/v1/logs",
      encode: (entries) => entries.map((entry) => entry.item).join(","),
      onDrop: (reason) => drops.push(reason),
    });
    delivery.enqueue("a", RESOURCE);
    await expect(delivery.close()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].body).toBe("a");
    expect(drops).toEqual([]);
  });

  test("ignores drops by default", async () => {
    const delivery = createDelivery<string>({
      url: "u",
      fetch: () => Promise.resolve(status(400)),
      encode: () => "",
      limits: { maxBatchSize: 1 },
    });
    delivery.enqueue("a", RESOURCE);
    await expect(delivery.flush()).resolves.toBe(true);
  });
});
