import type { Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failingIndexedDb, memoryIndexedDb } from "../../delivery/offline/fake-indexed-db.test-support";
import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";
import type { HttpTransportOfflineOptions, HttpTransportOptions } from "./http/options";
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

/** A fake `Window` and `Document` that record their listeners; `visibilityState` starts `"visible"`. */
function fakeLifecycle() {
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener(type: string, listener: () => void): void {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
  };
  const document = { ...target, visibilityState: "visible" };
  const fire = (type: string): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      listener();
    }
  };
  return {
    lifecycle: { window: target, document },
    fire,
    /** Sets `visibilityState` to `"hidden"` and fires `visibilitychange`. */
    hide(): void {
      document.visibilityState = "hidden";
      fire("visibilitychange");
    },
    /** How many listeners are registered for `type`. */
    watching: (type: string): number => listeners.get(type)?.size ?? 0,
  };
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

  it("drops only the unsettled half of a batch split for size as closed once its timeout elapses", async () => {
    const time = createManualTime();
    const calls: string[][] = [];
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as string[]);
      return calls.length === 1 ? Promise.resolve(new Response(null, { status: 200 })) : new Promise<Response>(() => {});
    }) as typeof globalThis.fetch;
    // Each event's body measures 600 bytes, so two together are over maxBatchBytes and split.
    const serialize = (events: readonly ErrorEvent[]) => JSON.stringify(events.map((event) => event.message)).padEnd(600 * events.length);
    const { transport, drops } = setup(time, { fetch, serialize, maxBatchBytes: 1000 });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    const closed = drive(time, transport.close(100), 50);

    await expect(closed).resolves.toBe(false);
    expect(calls).toEqual([["a"], ["b"]]);
    expect(drops).toEqual([{ messages: ["b"], reason: "closed" }]);
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

/** The `offline` option. */
function offline(settings: true | HttpTransportOfflineOptions): Partial<HttpTransportOptions> {
  return { offline: settings };
}

/** A step of {@link bodyFetch}: a status, a rejection as a network error gives, or a request that never settles. */
type BodyStep = number | "fail" | "hang";

/** A fake `fetch` recording each request's exact body and headers, answering with the next step; the last step repeats. */
function bodyFetch(...steps: BodyStep[]): { fetch: typeof fetch; requests: RequestInit[] } {
  const requests: RequestInit[] = [];
  const fake = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(init as RequestInit);
    const step = steps[Math.min(requests.length, steps.length) - 1] as BodyStep;
    if (step === "fail") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (step === "hang") {
      return new Promise<Response>(() => {});
    }
    return Promise.resolve(new Response(null, { status: step }));
  };
  return { fetch: fake as typeof fetch, requests };
}

/** The `message` of every event a saved envelope body carries. */
function savedMessages(body: string): string[] {
  return (JSON.parse(body) as { events: ErrorEvent[] }).events.map((event) => event.message as string);
}

/** A hanging `memoryIndexedDb` whose transactions started so far complete on `complete()`. */
function heldIndexedDb() {
  const db = memoryIndexedDb([], true);
  const started: IDBTransaction[] = [];
  const factory = {
    open: (name: string) => {
      const request = db.factory.open(name);
      const database = request.result;
      const transaction = database.transaction.bind(database);
      database.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
        const begun = transaction(...args);
        started.push(begun);
        return begun;
      }) as IDBDatabase["transaction"];
      return request;
    },
  } as unknown as IDBFactory;
  const complete = () => {
    for (const begun of started.splice(0)) {
      begun.oncomplete?.(new Event("complete"));
    }
  };
  return { factory, rows: db.rows, closed: db.closed, complete };
}

describe("createHttpTransport offline", () => {
  const key = `${url}|http-errors`;

  it("opens no store and reports retries-exhausted to onDrop when offline is off", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(503);
    const { transport, drops } = setup(time, { fetch, maxAttempts: 1 });

    transport.send(anEvent("a"), resource);

    expect(await drive(time, transport.flush())).toBe(true);
    expect(drops).toEqual([{ messages: ["a"], reason: "retries-exhausted" }]);
    expect(db.opens).toEqual([]);
  });

  it("saves a batch whose retries run out as the exact body sent, and reports nothing", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch, requests } = bodyFetch(503);
    const { transport, drops } = setup(time, { fetch, maxAttempts: 2, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);

    expect(await drive(time, transport.flush())).toBe(true);
    expect(db.opens).toEqual(["vipengele-otlp-offline"]);
    expect(db.rows.map(({ key: saved, count, body }) => ({ saved, count, body }))).toEqual([
      { saved: key, count: 2, body: requests[0]?.body },
    ]);
    expect(requests[1]?.body).toBe(requests[0]?.body);
    expect(drops).toEqual([]);
  });

  it("saves the batch in flight and every queued batch on close, each as its own body", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch, requests } = bodyFetch("hang");
    const { transport, drops } = setup(time, { fetch, lingerMs: 0, maxBatchEvents: 1, ...offline({ indexedDB: db.factory }) });

    for (const message of ["a", "b", "c"]) {
      transport.send(anEvent(message), resource);
    }
    await time.advance(0);
    await settleNow();
    const closing = transport.close(10);
    await settleNow();
    await time.advance(10);
    await closing;
    await settleNow();

    expect(db.rows.map(({ key: saved, count }) => [saved, count])).toEqual([
      [key, 1],
      [key, 1],
      [key, 1],
    ]);
    expect(db.rows[0]?.body).toBe(requests[0]?.body);
    expect(db.rows.map(({ body }) => savedMessages(body))).toEqual([["a"], ["b"], ["c"]]);
    expect(drops).toEqual([]);
  });

  it("drops an event on close as closed when it has no body to save", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch("hang");
    const serialize = (events: readonly ErrorEvent[]) => {
      if (events.some((event) => event.message === "bad")) {
        throw new Error("unserializable");
      }
      return JSON.stringify({ events });
    };
    const { transport, drops } = setup(time, { fetch, serialize, lingerMs: 0, maxBatchEvents: 1, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("good"), resource);
    transport.send(anEvent("bad"), resource);
    await time.advance(0);
    await settleNow();
    const closing = transport.close(10);
    await settleNow();
    await time.advance(10);
    await closing;
    await settleNow();

    expect(db.rows.map(({ body }) => savedMessages(body))).toEqual([["good"]]);
    expect(drops).toEqual([{ messages: ["bad"], reason: "closed" }]);
  });

  it.each([
    ["queue-full", { maxQueueEvents: 1 }, 200, ["a", "b"], ["b"]],
    ["too-large", { maxBatchBytes: 100 }, 200, ["x".repeat(200)], ["x".repeat(200)]],
    ["rejected", {}, 400, ["a", "b"], ["a", "b"]],
  ] as const)("never saves an event dropped as %s, and reports it to onDrop", async (reason, limits, status, sent, dropped) => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(status);
    const { transport, drops } = setup(time, { fetch, ...limits, ...offline({ indexedDB: db.factory }) });

    for (const message of sent) {
      transport.send(anEvent(message), resource);
    }

    expect(await drive(time, transport.flush())).toBe(true);
    expect(drops).toEqual([{ messages: [...dropped], reason }]);
    expect(db.rows).toEqual([]);
  });

  it("never saves an unsendable event, and reports it to onDrop", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(200);
    const serialize = () => {
      throw new Error("unserializable");
    };
    const { transport, drops } = setup(time, { fetch, serialize, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);
    await time.advance(1000);

    expect(await transport.flush()).toBe(true);
    expect(drops).toEqual([{ messages: ["a"], reason: "unsendable" }]);
    expect(db.rows).toEqual([]);
  });

  it("reports the events themselves as offline-full when the store refuses the body, after the save", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(503);
    const { transport, drops } = setup(time, {
      fetch,
      maxAttempts: 1,
      maxBatchEvents: 1,
      ...offline({ indexedDB: db.factory, maxEntries: 1 }),
    });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);

    expect(await drive(time, transport.flush())).toBe(true);
    expect(db.rows.map(({ body }) => savedMessages(body))).toEqual([["a"]]);
    expect(drops).toEqual([{ messages: ["b"], reason: "offline-full" }]);
  });

  it("reports a body held past the bounds before the store opens to onDrop after send returns", async () => {
    const time = createManualTime();
    const unopened = { open: () => ({}) } as unknown as IDBFactory;
    const { fetch } = bodyFetch(503);
    const { transport, drops } = setup(time, {
      fetch,
      maxAttempts: 1,
      maxBatchEvents: 1,
      ...offline({ indexedDB: unopened, maxEntries: 1 }),
    });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    expect(drops).toEqual([]);

    await time.advance(1000);
    await settleNow();

    expect(drops).toEqual([{ messages: ["b"], reason: "offline-full" }]);
  });

  it("reports the events themselves with their own reason when the store cannot be opened", async () => {
    const time = createManualTime();
    const { fetch } = bodyFetch(503);
    const { transport, drops } = setup(time, { fetch, maxAttempts: 1, ...offline({ indexedDB: failingIndexedDb() }) });

    transport.send(anEvent("a"), resource);
    expect(drops).toEqual([]);

    expect(await drive(time, transport.flush())).toBe(true);
    expect(drops).toEqual([{ messages: ["a"], reason: "retries-exhausted" }]);
  });

  it("warns once through the console for a failed save when no onDrop is given", async () => {
    const time = createManualTime();
    const warn = vi.fn();
    const { fetch } = bodyFetch(503);
    const { transport } = setup(time, {
      fetch,
      maxAttempts: 1,
      onDrop: undefined,
      console: { warn },
      ...offline({ indexedDB: failingIndexedDb() }),
    });

    transport.send(anEvent("a"), resource);
    await drive(time, transport.flush());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("retries-exhausted");
  });

  it("replays a saved body as it is, with the configured headers and contentType, and deletes it", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb([{ id: 1, key, body: "saved body", count: 2 }]);
    const { fetch, requests } = bodyFetch(200);
    setup(time, {
      fetch,
      headers: async () => ({ authorization: "Bearer x" }),
      contentType: "text/plain",
      ...offline({ indexedDB: db.factory }),
    });

    await vi.waitFor(() => expect(db.rows).toEqual([]));

    expect(requests.map((request) => request.body)).toEqual(["saved body"]);
    expect(requests[0]?.headers).toEqual({ authorization: "Bearer x", "content-type": "text/plain" });
  });

  it("gives up a replay whose async headers thunk hangs after requestTimeoutMs, so a later online replays", async () => {
    const page = fakeLifecycle();
    const time = createManualTime();
    const db = memoryIndexedDb([{ id: 1, key, body: "saved body", count: 2 }]);
    const { fetch, requests } = bodyFetch(200);
    let calls = 0;
    setup(time, {
      fetch,
      requestTimeoutMs: 1000,
      lifecycle: page.lifecycle,
      headers: () => (++calls === 1 ? new Promise<Record<string, string>>(() => {}) : Promise.resolve({ authorization: "Bearer x" })),
      ...offline({ indexedDB: db.factory }),
    });
    await vi.waitFor(() => expect(calls).toBe(1));

    await time.advance(1000);
    await settleNow();
    expect(requests).toEqual([]);
    expect(db.rows).toHaveLength(1);

    page.fire("online");

    await vi.waitFor(() => expect(db.rows).toEqual([]));
    expect(requests.map((request) => request.body)).toEqual(["saved body"]);
  });

  it("reports a saved body the endpoint rejects on replay as rejected, with no events", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb([{ id: 1, key, body: "saved body", count: 2 }]);
    const { fetch } = bodyFetch(400);
    const { drops } = setup(time, { fetch, ...offline({ indexedDB: db.factory }) });

    await vi.waitFor(() => expect(drops).toEqual([{ messages: [], reason: "rejected" }]));

    expect(db.rows).toEqual([]);
  });

  it("warns for a replay rejection when no onDrop is given", async () => {
    const time = createManualTime();
    const warn = vi.fn();
    const db = memoryIndexedDb([{ id: 1, key, body: "saved body", count: 2 }]);
    const { fetch } = bodyFetch(400);
    setup(time, { fetch, onDrop: undefined, console: { warn }, ...offline({ indexedDB: db.factory }) });

    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

    expect(warn.mock.calls[0]?.[0]).toContain("rejected");
  });

  it("keeps a saved body the endpoint answers with a status the transport retries", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb([{ id: 1, key, body: "saved body", count: 2 }]);
    const { fetch, requests } = bodyFetch(500);
    const { drops } = setup(time, { fetch, ...offline({ indexedDB: db.factory }) });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await settleNow();

    expect(db.rows).toHaveLength(1);
    expect(drops).toEqual([]);
  });

  it("ends the retries at once on a network error while the navigator is offline, and saves the batch", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch, requests } = bodyFetch("fail");
    const { transport, drops } = setup(time, { fetch, maxAttempts: 5, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);

    expect(await transport.flush()).toBe(true);
    expect(requests).toHaveLength(1);
    expect(time.clock()).toBe(0);
    expect(db.rows.map(({ body }) => body)).toEqual([requests[0]?.body]);
    expect(drops).toEqual([]);
  });

  it("waits for a pending save in an untimed flush", async () => {
    const time = createManualTime();
    const db = heldIndexedDb();
    const { fetch } = bodyFetch(503);
    const { transport } = setup(time, { fetch, maxAttempts: 1, lingerMs: 0, ...offline({ indexedDB: db.factory }) });
    let flushed: boolean | undefined;

    transport.send(anEvent("a"), resource);
    void transport.flush().then((drained) => {
      flushed = drained;
    });
    await settleNow();
    expect(flushed).toBeUndefined();

    db.complete();
    await settleNow();

    expect(flushed).toBe(true);
    expect(db.rows).toHaveLength(1);
  });

  it("resolves false from a timed flush while a save is still pending", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb([], true);
    const { fetch } = bodyFetch(503);
    const { transport } = setup(time, { fetch, maxAttempts: 1, lingerMs: 0, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);
    const flushing = transport.flush(10);
    await settleNow();
    await time.advance(10);

    expect(await flushing).toBe(false);
  });

  it("closes the store once close has settled the saves, and a later flush resolves true", async () => {
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(503);
    const { transport } = setup(time, { fetch, maxAttempts: 1, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);

    expect(await transport.close()).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.closed()).toBe(1);
    expect(await transport.flush()).toBe(true);
  });

  it("resolves false from close while a save is pending and closes the store once the save completes", async () => {
    const time = createManualTime();
    const db = heldIndexedDb();
    const { fetch } = bodyFetch(503);
    const { transport } = setup(time, { fetch, maxAttempts: 1, lingerMs: 0, ...offline({ indexedDB: db.factory }) });

    transport.send(anEvent("a"), resource);
    await time.advance(0);
    await settleNow();
    const closing = transport.close(10);
    await settleNow();
    await time.advance(10);

    expect(await closing).toBe(false);
    expect(db.closed()).toBe(0);

    db.complete();
    await settleNow();
    expect(db.closed()).toBe(1);
  });
});

describe("createHttpTransport unload", () => {
  const key = `${url}|http-errors`;
  const otherResource: Resource = Object.freeze({ ...resource, "service.name": "billing" });
  /** An event whose default envelope measures a little over 30 KB, so two fit the keepalive budget and three do not. */
  const big = (name: string): ErrorEvent => anEvent(name + "x".repeat(30_000));
  const short = (message: string): string => message.slice(0, 1);

  /** The events each keepalive request carried, by the first letter of their messages. */
  function keepalives(requests: RequestInit[]): string[][] {
    return requests.filter((request) => request.keepalive === true).map((request) => savedMessages(String(request.body)).map(short));
  }

  it("sends what is queued as one keepalive request with the configured headers and contentType on pagehide", async () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, {
      fetch,
      lifecycle: page.lifecycle,
      headers: { authorization: "Bearer x" },
      contentType: "text/plain",
    });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), resource);
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a", "b"]]);
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(new Headers(requests[0]?.headers))).toEqual({ authorization: "Bearer x", "content-type": "text/plain" });
    expect(drops).toEqual([]);
    expect(await transport.flush(0)).toBe(true);

    await time.advance(1000);
    await settleNow();
    expect(requests).toHaveLength(1);
  });

  it("finds nothing left to send on the pagehide that follows a visibilitychange to hidden", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport } = setup(time, { fetch, lifecycle: page.lifecycle });

    transport.send(anEvent("a"), resource);
    page.fire("visibilitychange");
    expect(requests).toEqual([]);

    page.hide();
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a"]]);
    expect(requests).toHaveLength(1);
  });

  it("sends nothing when nothing is pending", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    setup(time, { fetch, lifecycle: page.lifecycle });

    page.fire("pagehide");

    expect(requests).toEqual([]);
  });

  it("aborts the attempt in flight and sends its events ahead of the queued ones, then keeps working", async () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch("hang", 200);
    const { transport, drops } = setup(time, { fetch, lingerMs: 0, lifecycle: page.lifecycle });

    transport.send(anEvent("a"), resource);
    await time.advance(0);
    await settleNow();
    expect(requests).toHaveLength(1);
    transport.send(anEvent("b"), resource);
    transport.send(anEvent("c"), resource);

    page.fire("pagehide");
    await settleNow();

    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(keepalives(requests)).toEqual([["a", "b", "c"]]);
    expect(drops).toEqual([]);

    transport.send(anEvent("d"), resource);
    expect(await drive(time, transport.flush())).toBe(true);
    expect(requests.map((request) => savedMessages(String(request.body)))).toEqual([["a"], ["a", "b", "c"], ["d"]]);
    expect(drops).toEqual([]);
  });

  it("sends the largest oldest prefix within the keepalive budget and drops the rest as unload-budget", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, lifecycle: page.lifecycle });

    for (const name of ["a", "b", "c"]) {
      transport.send(big(name), resource);
    }
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a", "b"]]);
    expect(drops.map(({ messages, reason }) => ({ messages: messages.map(short), reason }))).toEqual([
      { messages: ["c"], reason: "unload-budget" },
    ]);
  });

  it("saves the rest through the offline queue, and reports nothing", async () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const db = memoryIndexedDb();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, lifecycle: page.lifecycle, ...offline({ indexedDB: db.factory }) });

    for (const name of ["a", "b", "c"]) {
      transport.send(big(name), resource);
    }
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a", "b"]]);
    await vi.waitFor(() => expect(db.rows).toHaveLength(1));
    expect(db.rows.map((row) => ({ key: row.key, messages: savedMessages(row.body).map(short) }))).toEqual([{ key, messages: ["c"] }]);
    expect(drops).toEqual([]);
  });

  it("sends only the events sharing the oldest one's Resource, and gives up on the others", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, lifecycle: page.lifecycle });

    transport.send(anEvent("a"), resource);
    transport.send(anEvent("b"), otherResource);
    transport.send(anEvent("c"), resource);
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a"]]);
    expect(drops).toEqual([{ messages: ["b", "c"], reason: "unload-budget" }]);
  });

  it("carries at most maxBatchEvents events", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, maxBatchEvents: 2, lifecycle: page.lifecycle });

    for (const name of ["a", "b", "c"]) {
      transport.send(anEvent(name), resource);
    }
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a", "b"]]);
    expect(drops).toEqual([{ messages: ["c"], reason: "unload-budget" }]);
  });

  it("keeps the body within maxBatchBytes when that is below the keepalive budget", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, maxBatchBytes: 600, lifecycle: page.lifecycle });

    for (const name of ["a", "b", "c"]) {
      transport.send(anEvent(name.repeat(100)), resource);
    }
    page.fire("pagehide");

    expect(keepalives(requests)).toEqual([["a"]]);
    expect(drops.map(({ messages, reason }) => ({ messages: messages.map(short), reason }))).toEqual([
      { messages: ["b", "c"], reason: "unload-budget" },
    ]);
  });

  it("sends no request when the oldest event alone is over the budget, and gives up on every event", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const { transport, drops } = setup(time, { fetch, maxBatchBytes: 200_000, lifecycle: page.lifecycle });

    transport.send(anEvent("a".repeat(70_000)), resource);
    transport.send(anEvent("b"), resource);
    page.fire("pagehide");

    expect(requests).toEqual([]);
    expect(drops.map(({ messages, reason }) => ({ messages: messages.map(short), reason }))).toEqual([
      { messages: ["a", "b"], reason: "unload-budget" },
    ]);
  });

  it("drops the request's events as unsendable when the serializer throws on them", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const serialize = (events: readonly ErrorEvent[]) => {
      if (events.some((event) => event.message === "bad")) {
        throw new Error("unserializable");
      }
      return JSON.stringify({ events });
    };
    const { transport, drops } = setup(time, { fetch, serialize, lifecycle: page.lifecycle });

    transport.send(anEvent("bad"), resource);
    transport.send(anEvent("b"), otherResource);
    page.fire("pagehide");

    expect(requests).toEqual([]);
    expect(drops).toEqual([
      { messages: ["bad"], reason: "unsendable" },
      { messages: ["b"], reason: "unload-budget" },
    ]);
  });

  it("drops the request's events as unsendable when the headers function throws", () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch, requests } = bodyFetch(200);
    const headers = () => {
      throw new Error("no token");
    };
    const { transport, drops } = setup(time, { fetch, headers, lifecycle: page.lifecycle });

    transport.send(anEvent("a"), resource);
    page.fire("pagehide");

    expect(requests).toEqual([]);
    expect(drops).toEqual([{ messages: ["a"], reason: "unsendable" }]);
  });

  it("removes both listeners once close has flushed", async () => {
    const time = createManualTime();
    const page = fakeLifecycle();
    const { fetch } = bodyFetch(200);
    const { transport } = setup(time, { fetch, lifecycle: page.lifecycle });
    expect(page.watching("pagehide")).toBe(1);
    expect(page.watching("visibilitychange")).toBe(1);

    expect(await transport.close()).toBe(true);

    expect(page.watching("pagehide")).toBe(0);
    expect(page.watching("visibilitychange")).toBe(0);
  });

  it("watches nothing for lifecycle {}, neither the unload nor the online replay, even on a window-like global", () => {
    const added: string[] = [];
    vi.stubGlobal("onpagehide", null);
    vi.stubGlobal("addEventListener", (type: string) => {
      added.push(type);
    });
    vi.stubGlobal("removeEventListener", () => {});
    const time = createManualTime();
    const db = memoryIndexedDb();
    const { fetch } = bodyFetch(200);

    setup(time, { fetch, lifecycle: {}, ...offline({ indexedDB: db.factory }) });
    expect(added).toEqual([]);

    setup(time, { fetch, ...offline({ indexedDB: db.factory }) });
    expect(added.sort()).toEqual(["online", "pagehide"]);
  });
});
