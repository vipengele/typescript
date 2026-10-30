import type { Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";
import type { HttpTransportOptions } from "./http/options";
import type { DropReason } from "./http/queue";
import { createHttpTransport } from "./http-transport";
import { isHttpTransportConfigError } from "./http-transport-config-error";

const url = "https://errors.example.com/ingest";

function anEvent(message = "m"): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 0,
    level: "error",
    message,
    mechanism: { handled: true, source: "capture" },
    attributes: {},
  };
}

const resource: Resource = Object.freeze({
  "service.name": "shop",
  "service.version": "1.0.0",
  "service.dist": undefined,
  "deployment.environment.name": "production",
  "process.runtime.name": "nodejs",
  "process.runtime.version": "24.0.0",
  "os.type": "linux",
  "os.version": "6.1",
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
});

interface Call {
  readonly at: number;
  /** The `message` of every event the request carried, in order. */
  readonly messages: string[];
}

/** A response, a status for one with no body, or a value the fake throws synchronously. */
type Step = number | Response | { readonly throw: unknown };

/** A fake `fetch` answering each call with the next step; the last step repeats. */
function fakeFetch(time: ManualTime, ...steps: Step[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { events: ErrorEvent[] };
    calls.push({ at: time.clock(), messages: body.events.map((event) => event.message as string) });
    const step = steps[Math.min(calls.length, steps.length) - 1] as Step;
    if (typeof step === "number") {
      return Promise.resolve(new Response(null, { status: step }));
    }
    if (step instanceof Response) {
      return Promise.resolve(step);
    }
    throw step.throw;
  };
  return { fetch: fake as typeof fetch, calls };
}

function retryAfter(status: number, seconds: number): Response {
  return new Response(null, { status, headers: { "Retry-After": String(seconds) } });
}

interface Drop {
  readonly messages: string[];
  readonly reason: DropReason;
}

function setup(time: ManualTime, options: Partial<HttpTransportOptions> = {}): { transport: Transport; drops: Drop[] } {
  const drops: Drop[] = [];
  const transport = createHttpTransport({
    url,
    clock: time.clock,
    scheduler: time.scheduler,
    random: () => 0.5,
    onDrop: (events, reason) => {
      drops.push({ messages: events.map((event) => event.message as string), reason });
    },
    ...options,
  });
  return { transport, drops };
}

function hop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Lets pending microtasks and fake responses run without moving virtual time. */
async function settleNow(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await hop();
  }
}

/** Moves virtual time forward in `stepMs` steps until `pending` settles. */
async function drive<T>(time: ManualTime, pending: Promise<T>, stepMs = 60_000): Promise<T> {
  let done = false;
  void pending.then(() => {
    done = true;
  });
  while (!done) {
    await hop();
    if (!done) {
      await time.advance(stepMs);
    }
  }
  return pending;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createHttpTransport construction", () => {
  it("throws an HttpTransportConfigError for an invalid option", () => {
    let thrown: unknown;
    try {
      createHttpTransport({ url: "/relative" });
    } catch (error) {
      thrown = error;
    }

    expect(isHttpTransportConfigError(thrown)).toBe(true);
  });
});

describe("createHttpTransport batching", () => {
  it("lingers to gather several events into one request", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const { transport } = setup(time, { fetch, lingerMs: 1000 });

    transport.send(anEvent("a"), resource);
    await time.advance(400);
    transport.send(anEvent("b"), resource);
    transport.send(anEvent("c"), resource);
    await time.advance(599);
    await settleNow();
    expect(calls).toEqual([]);

    await time.advance(1);
    await settleNow();

    expect(calls).toEqual([{ at: 1000, messages: ["a", "b", "c"] }]);
  });

  it("sends a backlog batch after batch with no linger between them", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const { transport } = setup(time, { fetch, lingerMs: 1000, maxBatchEvents: 2 });

    for (const message of ["a", "b", "c", "d", "e"]) {
      transport.send(anEvent(message), resource);
    }
    await time.advance(1000);
    await settleNow();

    expect(calls).toEqual([
      { at: 1000, messages: ["a", "b"] },
      { at: 1000, messages: ["c", "d"] },
      { at: 1000, messages: ["e"] },
    ]);
  });

  it("holds a second batch back behind a 429's Retry-After", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(429, 5), 200);
    const { transport } = setup(time, { fetch, lingerMs: 0, maxBatchEvents: 1 });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    await time.advance(0);
    await settleNow();
    expect(calls).toEqual([{ at: 0, messages: ["a"] }]);

    await time.advance(4999);
    await settleNow();
    expect(calls).toHaveLength(1);

    await time.advance(1);
    await settleNow();

    expect(calls).toEqual([
      { at: 0, messages: ["a"] },
      { at: 5000, messages: ["a"] },
      { at: 5000, messages: ["b"] },
    ]);
  });

  it("picks up an event sent while a request is in flight without starting a linger", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(503, 5), 200);
    const { transport } = setup(time, { fetch, lingerMs: 0 });

    transport.send(anEvent("a"), resource);
    await time.advance(0);
    await settleNow();
    transport.send(anEvent("b"), resource);
    // The only pending sleep is the Retry-After wait.
    expect(time.pendingSleeps).toBe(1);

    await time.advance(5000);
    await settleNow();

    expect(calls).toEqual([
      { at: 0, messages: ["a"] },
      { at: 5000, messages: ["a"] },
      { at: 5000, messages: ["b"] },
    ]);
  });
});

describe("createHttpTransport flush", () => {
  it("resolves true at once with nothing accepted", async () => {
    const time = createManualTime();
    const { transport } = setup(time, { fetch: fakeFetch(time, 200).fetch });

    await expect(transport.flush()).resolves.toBe(true);
  });

  it("cuts the linger short and resolves true once delivered", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const { transport, drops } = setup(time, { fetch, lingerMs: 1000 });

    transport.send(anEvent("a"), resource);
    const flushed = await transport.flush();

    expect(flushed).toBe(true);
    expect(calls).toEqual([{ at: 0, messages: ["a"] }]);
    expect(drops).toEqual([]);
    expect(time.pendingSleeps).toBe(0);
  });

  it("without a timeout, waits out a Retry-After and resolves true", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(429, 10), 200);
    const { transport } = setup(time, { fetch });

    transport.send(anEvent("a"), resource);
    const flushed = await drive(time, transport.flush(), 1000);

    expect(flushed).toBe(true);
    expect(calls.map((call) => call.at)).toEqual([0, 10_000]);
  });

  it("resolves true once a batch is dropped", async () => {
    const time = createManualTime();
    const { fetch } = fakeFetch(time, 400);
    const { transport, drops } = setup(time, { fetch });

    transport.send(anEvent("a"), resource);

    await expect(transport.flush()).resolves.toBe(true);
    expect(drops).toEqual([{ messages: ["a"], reason: "rejected" }]);
  });

  it("resolves false when its timeout elapses first, and clears its timer when it resolves true", async () => {
    const time = createManualTime();
    const { fetch } = fakeFetch(time, retryAfter(503, 10), 200);
    const { transport } = setup(time, { fetch });

    transport.send(anEvent("a"), resource);
    const timedOut = transport.flush(3000);
    const untimed = transport.flush(60_000);
    const result = await drive(time, timedOut, 1000);

    expect(result).toBe(false);
    expect(time.clock()).toBe(3000);

    await expect(drive(time, untimed, 1000)).resolves.toBe(true);
    expect(time.clock()).toBe(10_000);
    expect(time.pendingSleeps).toBe(0);
  });

  it("does not wait on events sent after it was called", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const { transport } = setup(time, { fetch, lingerMs: 1000 });

    transport.send(anEvent("a"), resource);
    const first = transport.flush();
    transport.send(anEvent("b"), resource);
    const second = transport.flush();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(calls.map((call) => call.messages)).toEqual([["a"], ["b"]]);
  });
});

describe("createHttpTransport close", () => {
  it("returns the same promise from a second close", async () => {
    const time = createManualTime();
    const { transport } = setup(time, { fetch: fakeFetch(time, 200).fetch });

    const first = transport.close();
    const second = transport.close(100);

    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
  });

  it("delivers what is queued, then turns flush into true and send into a no-op", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const { transport, drops } = setup(time, { fetch, maxQueueEvents: 1 });

    transport.send(anEvent("a"), resource);
    await expect(transport.close()).resolves.toBe(true);
    expect(calls).toEqual([{ at: 0, messages: ["a"] }]);

    transport.send(anEvent("b"), resource);
    transport.send(anEvent("c"), resource);
    await time.advance(60_000);
    await settleNow();

    await expect(transport.flush()).resolves.toBe(true);
    await expect(transport.flush(10)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(drops).toEqual([]);
    expect(time.pendingSleeps).toBe(0);
  });

  it("drops the in-flight and the queued events as closed once its timeout elapses", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(503, 10));
    const { transport, drops } = setup(time, { fetch, lingerMs: 0, maxBatchEvents: 1 });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    transport.send(anEvent("c"), resource);
    const closed = drive(time, transport.close(2000), 500);

    await expect(closed).resolves.toBe(false);
    expect(drops).toEqual([
      { messages: ["a"], reason: "closed" },
      { messages: ["b", "c"], reason: "closed" },
    ]);

    await time.advance(60_000);
    await settleNow();
    expect(calls).toEqual([{ at: 0, messages: ["a"] }]);
    expect(drops).toHaveLength(2);
    expect(time.pendingSleeps).toBe(0);
  });

  it("does not wait on a fetch that ignores the abort", async () => {
    const time = createManualTime();
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    const { transport, drops } = setup(time, { fetch });

    transport.send(anEvent("a"), resource);
    const closed = drive(time, transport.close(100), 50);

    await expect(closed).resolves.toBe(false);
    expect(drops).toEqual([{ messages: ["a"], reason: "closed" }]);
  });
});

describe("createHttpTransport drops", () => {
  it("reports an event refused by a full queue", () => {
    const time = createManualTime();
    const { transport, drops } = setup(time, { fetch: fakeFetch(time, 200).fetch, maxQueueEvents: 1 });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);

    expect(drops).toEqual([{ messages: ["b"], reason: "queue-full" }]);
  });

  it("warns once per reason through the console when no onDrop is given", async () => {
    const time = createManualTime();
    const warn = vi.fn();
    const { fetch } = fakeFetch(time, 400);
    const { transport } = setup(time, { fetch, maxQueueEvents: 1, onDrop: undefined, console: { warn } });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    transport.send(anEvent("c"), resource);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("queue-full");

    await transport.flush();
    transport.send(anEvent("d"), resource);
    await transport.flush();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain("rejected");
  });

  it("drops silently with no onDrop and no console", () => {
    const time = createManualTime();
    vi.stubGlobal("console", undefined);
    const { transport } = setup(time, { fetch: fakeFetch(time, 200).fetch, maxQueueEvents: 1, onDrop: undefined });
    vi.unstubAllGlobals();

    transport.send(anEvent("a"), resource);

    expect(() => transport.send(anEvent("b"), resource)).not.toThrow();
  });
});

describe("createHttpTransport send never throws", () => {
  it("when fetch throws synchronously", async () => {
    const time = createManualTime();
    const { fetch } = fakeFetch(time, { throw: new TypeError("no network") });
    const { transport, drops } = setup(time, { fetch, maxAttempts: 1 });

    expect(() => transport.send(anEvent("a"), resource)).not.toThrow();
    await transport.flush();

    expect(drops).toEqual([{ messages: ["a"], reason: "retries-exhausted" }]);
  });

  it("when onDrop throws, and keeps delivering", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 400, 200);
    const onDrop = vi.fn(() => {
      throw new Error("boom");
    });
    const { transport } = setup(time, { fetch, maxQueueEvents: 1, maxBatchEvents: 1, onDrop });

    transport.send(anEvent("a"), resource);
    expect(() => transport.send(anEvent("b"), resource)).not.toThrow();
    await expect(transport.flush()).resolves.toBe(true);
    transport.send(anEvent("c"), resource);
    await expect(transport.flush()).resolves.toBe(true);

    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.messages)).toEqual([["a"], ["c"]]);
  });

  it("when the scheduler throws, and a flush still sends the event", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const scheduler: Scheduler = {
      sleep() {
        throw new Error("no timers");
      },
    };
    const { transport } = setup(time, { fetch, scheduler });

    expect(() => transport.send(anEvent("a"), resource)).not.toThrow();
    await expect(transport.flush()).resolves.toBe(true);

    expect(calls).toEqual([{ at: 0, messages: ["a"] }]);
  });
});
