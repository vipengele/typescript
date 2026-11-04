import { createManualTime } from "@vipengele/ts-core-common/testing";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DeliveryEntry, DeliveryFetch, DeliveryRequest, DeliveryResponse } from "../delivery";
import { type OfflineDropReason, OfflineQueue, type OfflineQueueOptions } from "./offline-queue";
import type { NewStoredBody, OfflineStore, PutOutcome, StoredBody } from "./store";

const URL = "https://collector.example/v1/logs";
const KEY = `${URL}|logs`;
const RESOURCE = {} as Resource;
const LIMITS = { maxEntries: 3, maxBytes: 100 };

function entries(...items: string[]): DeliveryEntry<string>[] {
  return items.map((item) => ({ item, resource: RESOURCE, observedMs: 0 }));
}

function encode(batch: ReadonlyArray<DeliveryEntry<string>>): string {
  return JSON.stringify(batch.map((entry) => entry.item));
}

/** An in-memory store; `outcome` overrides what `put` resolves, and `forgetDeletes` keeps deleted bodies. */
class FakeStore implements OfflineStore {
  readonly bodies: StoredBody[] = [];
  readonly calls: string[] = [];
  outcome: PutOutcome | undefined;
  forgetDeletes = false;
  #next = 1;

  put(record: NewStoredBody): Promise<PutOutcome> {
    this.calls.push(`put ${record.body}`);
    if (this.outcome !== undefined) {
      return Promise.resolve(this.outcome);
    }
    this.bodies.push({ ...record, id: this.#next++, bytes: record.body.length });
    return Promise.resolve("stored");
  }

  oldest(key: string): Promise<StoredBody | undefined> {
    this.calls.push("oldest");
    return Promise.resolve(this.bodies.find((body) => body.key === key));
  }

  delete(id: number): Promise<void> {
    this.calls.push(`delete ${id}`);
    if (!this.forgetDeletes) {
      this.bodies.splice(
        this.bodies.findIndex((body) => body.id === id),
        1,
      );
    }
    return Promise.resolve();
  }

  close(): void {
    this.calls.push("close");
  }

  seed(...bodies: string[]): void {
    for (const body of bodies) {
      this.bodies.push({ id: this.#next++, key: KEY, body, count: 1, bytes: body.length, storedAt: 0 });
    }
  }
}

class FakeWindow {
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function response(status: number, body?: DeliveryResponse["body"]): DeliveryResponse {
  return { status, headers: { get: () => null }, body };
}

/** A fetch whose requests are answered by the test, one by one. */
function manualFetch() {
  const requests: { url: string; init: DeliveryRequest; answer: (value: DeliveryResponse) => void; fail: (error: unknown) => void }[] = [];
  const fetch: DeliveryFetch = (url, init) =>
    new Promise((answer, fail) => {
      requests.push({ url, init, answer, fail });
    });
  return { fetch, requests };
}

/** A fetch answering every request with the next status of `statuses`, then 200. */
function scriptedFetch(...statuses: number[]) {
  const bodies: string[] = [];
  const fetch = vi.fn<DeliveryFetch>((_url, init) => {
    bodies.push(init.body);
    return Promise.resolve(response(statuses.shift() ?? 200));
  });
  return { fetch, bodies };
}

/** Lets every pending promise continuation run. */
async function settled(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function deferred<V>() {
  let resolve: (value: V) => void = () => {};
  const promise = new Promise<V>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function create(overrides: Partial<OfflineQueueOptions<string>> = {}) {
  const drops: [OfflineDropReason, number][] = [];
  const store = new FakeStore();
  const queue = new OfflineQueue<string>({
    key: KEY,
    encode,
    url: URL,
    fetch: scriptedFetch().fetch,
    store: Promise.resolve(store),
    limits: LIMITS,
    onDrop: (reason, count) => drops.push([reason, count]),
    clock: () => 1234,
    ...overrides,
  });
  return { queue, store, drops };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persisting", () => {
  test("saves the encoded entries with their count, key and time, and reports nothing", async () => {
    const { queue, store, drops } = create({ fetch: manualFetch().fetch });
    await settled();

    queue.undelivered(entries("a", "b"), "retries-exhausted");
    await settled();

    expect(store.bodies).toEqual([{ id: 1, key: KEY, body: '["a","b"]', count: 2, bytes: 9, storedAt: 1234 }]);
    expect(drops).toEqual([]);
  });

  test("reports a body the store refuses as full as offline-full", async () => {
    const { queue, store, drops } = create();
    store.outcome = "full";

    queue.undelivered(entries("a", "b"), "closed");
    await settled();

    expect(drops).toEqual([["offline-full", 2]]);
  });

  test.each(["retries-exhausted", "closed", "unload-budget"] as const)("reports a failed write with its own reason, %s", async (reason) => {
    const { queue, store, drops } = create();
    store.outcome = "failed";

    queue.undelivered(entries("a"), reason);
    await settled();

    expect(drops).toEqual([[reason, 1]]);
  });

  test("reports a put that rejects as a failed write", async () => {
    const { queue, store, drops } = create();
    store.put = () => Promise.reject(new Error("broken"));

    queue.undelivered(entries("a"), "closed");
    await settled();

    expect(drops).toEqual([["closed", 1]]);
  });

  test("reports entries whose encoding throws as rejected, without a write", async () => {
    const { queue, store, drops } = create({
      encode: () => {
        throw new Error("unencodable");
      },
    });
    await settled();

    queue.undelivered(entries("a", "b", "c"), "retries-exhausted");
    await settled();

    expect(drops).toEqual([["rejected", 3]]);
    expect(store.calls.filter((call) => call.startsWith("put"))).toEqual([]);
  });

  test("swallows a throwing onDrop", async () => {
    const { queue, store } = create({
      onDrop: () => {
        throw new Error("observer");
      },
    });
    store.outcome = "full";

    queue.undelivered(entries("a"), "closed");
    await settled();

    expect(await queue.settle(0)).toBe(true);
  });

  test("defaults the clock to the system clock", async () => {
    const { queue, store } = create({ clock: undefined });

    queue.undelivered(entries("a"), "closed");
    await settled();

    // The system clock reads the monotonic timer, which may drift from Date.now() by a little.
    expect(Math.abs((store.bodies[0]?.storedAt ?? 0) - Date.now())).toBeLessThan(60_000);
  });
});

describe("saveBody", () => {
  function saving(overrides: Partial<OfflineQueueOptions<string>> = {}) {
    const created = create({ fetch: manualFetch().fetch, ...overrides });
    const refused: OfflineDropReason[] = [];
    const save = (body: string, count: number, reason: "retries-exhausted" | "closed" = "closed") =>
      created.queue.saveBody(body, count, reason, (dropped) => refused.push(dropped));
    return { ...created, refused, save };
  }

  test("saves the body as given with the count given, telling no one", async () => {
    const { store, drops, refused, save } = saving();
    await settled();

    save("exact body", 3, "retries-exhausted");
    await settled();

    expect(store.bodies).toEqual([{ id: 1, key: KEY, body: "exact body", count: 3, bytes: 10, storedAt: 1234 }]);
    expect(drops).toEqual([]);
    expect(refused).toEqual([]);
  });

  test("tells the listener, not onDrop, of a body the store refuses as full", async () => {
    const { store, drops, refused, save } = saving();
    store.outcome = "full";

    save("x", 2);
    await settled();

    expect(refused).toEqual(["offline-full"]);
    expect(drops).toEqual([]);
  });

  test.each(["retries-exhausted", "closed"] as const)("tells the listener of a failed write with its own reason, %s", async (reason) => {
    const { store, refused, save } = saving();
    store.outcome = "failed";

    save("x", 1, reason);
    await settled();

    expect(refused).toEqual([reason]);
  });

  test("tells the listener of a body held past the bounds before the store opens, at once", () => {
    const { refused, save } = saving({ store: new Promise(() => {}), limits: { maxEntries: 1, maxBytes: 1000 } });

    save("a", 1);
    save("b", 1);

    expect(refused).toEqual(["offline-full"]);
  });

  test("tells the listener with the reason given when there is no store", async () => {
    const { refused, save } = saving({ store: Promise.resolve(undefined) });

    save("a", 4, "retries-exhausted");
    await settled();

    expect(refused).toEqual(["retries-exhausted"]);
  });

  test("swallows a throwing listener", async () => {
    const { queue, store } = saving();
    store.outcome = "full";

    queue.saveBody("x", 1, "closed", () => {
      throw new Error("observer");
    });
    await settled();

    expect(await queue.settle(0)).toBe(true);
  });

  test("reports undelivered entries as rejected, without a write, when the queue has no encoder", async () => {
    const { queue, store, drops } = create({ encode: undefined });
    await settled();

    queue.undelivered(entries("a", "b"), "closed");
    await settled();

    expect(drops).toEqual([["rejected", 2]]);
    expect(store.calls.filter((call) => call.startsWith("put"))).toEqual([]);
  });
});

describe("with no store", () => {
  test("reports every write with its own reason", async () => {
    const { queue, drops } = create({ store: Promise.resolve(undefined) });

    queue.undelivered(entries("a"), "unload-budget");
    await settled();
    queue.undelivered(entries("b", "c"), "retries-exhausted");
    await settled();

    expect(drops).toEqual([
      ["unload-budget", 1],
      ["retries-exhausted", 2],
    ]);
  });

  test("reads a rejected open as no store", async () => {
    const { queue, drops } = create({ store: Promise.reject(new Error("no indexedDB")) });

    queue.undelivered(entries("a"), "closed");
    await settled();

    expect(drops).toEqual([["closed", 1]]);
  });

  test("ignores online", async () => {
    const window = new FakeWindow();
    const { fetch } = scriptedFetch();
    create({ store: Promise.resolve(undefined), window, fetch });
    await settled();

    window.fire("online");
    await settled();

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("before the store opens", () => {
  test("holds writes in memory and saves them once it opens", async () => {
    const open = deferred<OfflineStore | undefined>();
    const store = new FakeStore();
    const { queue, drops } = create({ store: open.promise, fetch: manualFetch().fetch });

    queue.undelivered(entries("a"), "closed");
    queue.undelivered(entries("b", "c"), "retries-exhausted");
    await settled();
    expect(store.bodies).toEqual([]);

    open.resolve(store);
    await settled();

    expect(store.bodies.map((body) => [body.body, body.count])).toEqual([
      ['["a"]', 1],
      ['["b","c"]', 2],
    ]);
    expect(drops).toEqual([]);
  });

  test("reports a held write past maxEntries as offline-full", async () => {
    const open = deferred<OfflineStore | undefined>();
    const { queue, drops } = create({ store: open.promise, limits: { maxEntries: 2, maxBytes: 1000 } });

    queue.undelivered(entries("a"), "closed");
    queue.undelivered(entries("b"), "closed");
    queue.undelivered(entries("c", "d"), "closed");

    expect(drops).toEqual([["offline-full", 2]]);
  });

  test("reports a held write past maxBytes as offline-full", async () => {
    const open = deferred<OfflineStore | undefined>();
    const { queue, drops } = create({ store: open.promise, limits: { maxEntries: 10, maxBytes: 10 } });

    queue.undelivered(entries("a"), "closed");
    queue.undelivered(entries("é"), "closed");
    queue.undelivered(entries("b"), "closed");

    // `["a"]` is 5 bytes and `["é"]` 6, so the second write already passes 10.
    expect(drops).toEqual([["offline-full", 1]]);
  });

  test("reports held writes with their own reason when the open yields no store", async () => {
    const open = deferred<OfflineStore | undefined>();
    const { queue, drops } = create({ store: open.promise });

    queue.undelivered(entries("a"), "closed");
    queue.undelivered(entries("b", "c"), "unload-budget");
    open.resolve(undefined);
    await settled();

    expect(drops).toEqual([
      ["closed", 1],
      ["unload-budget", 2],
    ]);
  });

  test("stops counting against the memory bounds once the store opens", async () => {
    const open = deferred<OfflineStore | undefined>();
    const store = new FakeStore();
    const { queue, drops } = create({ store: open.promise, limits: { maxEntries: 1, maxBytes: 1000 }, fetch: manualFetch().fetch });

    queue.undelivered(entries("a"), "closed");
    open.resolve(store);
    await settled();
    queue.undelivered(entries("b"), "closed");
    queue.undelivered(entries("c"), "closed");
    await settled();

    expect(store.bodies).toHaveLength(3);
    expect(drops).toEqual([]);
  });
});

describe("replay", () => {
  test("sends the key's bodies oldest first, one at a time, and deletes each on 2xx", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    store.bodies.push({ id: 99, key: "other", body: "theirs", count: 1, bytes: 6, storedAt: 0 });
    const { fetch, requests } = manualFetch();
    create({ store: Promise.resolve(store), fetch, headers: () => ({ authorization: "Bearer x" }) });
    await settled();

    expect(requests.map((request) => request.init.body)).toEqual(["one"]);
    expect(requests[0]?.url).toBe(URL);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer x", "content-type": "application/json" },
    });
    requests[0]?.answer(response(204));
    await settled();
    expect(requests.map((request) => request.init.body)).toEqual(["one", "two"]);
    requests[1]?.answer(response(200));
    await settled();

    expect(store.bodies.map((body) => body.body)).toEqual(["theirs"]);
    expect(store.calls).toEqual(["oldest", "delete 1", "oldest", "delete 2", "oldest"]);
  });

  test("sends static headers with content-type application/json", async () => {
    const store = new FakeStore();
    store.seed("one");
    const { fetch, requests } = manualFetch();
    create({ store: Promise.resolve(store), fetch, headers: { "x-key": "k", "content-type": "text/plain" } });
    await settled();

    expect(requests[0]?.init.headers).toEqual({ "x-key": "k", "content-type": "application/json" });
  });

  test("awaits a headers thunk that returns a promise, and sends the configured contentType", async () => {
    const store = new FakeStore();
    store.seed("one");
    const { fetch, requests } = manualFetch();
    create({ store: Promise.resolve(store), fetch, headers: async () => ({ authorization: "Bearer y" }), contentType: "text/plain" });
    await settled();

    expect(requests[0]?.init.headers).toEqual({ authorization: "Bearer y", "content-type": "text/plain" });
  });

  test("stops and keeps the body when the headers thunk rejects", async () => {
    const store = new FakeStore();
    store.seed("one");
    const { fetch, bodies } = scriptedFetch();
    create({ store: Promise.resolve(store), fetch, headers: () => Promise.reject(new Error("no token")) });
    await settled();

    expect(bodies).toEqual([]);
    expect(store.bodies).toHaveLength(1);
  });

  test("reads each status through the classify option", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const { fetch, bodies } = scriptedFetch(500);
    const { drops } = create({ store: Promise.resolve(store), fetch, classify: (status) => (status === 500 ? "retryable" : "delivered") });
    await settled();

    expect(bodies).toEqual(["one"]);
    expect(store.bodies).toHaveLength(2);
    expect(drops).toEqual([]);
  });

  test("deletes a body answered with a non-retryable status and reports it rejected", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const { fetch, bodies } = scriptedFetch(400);
    const { drops } = create({ store: Promise.resolve(store), fetch });
    await settled();

    expect(bodies).toEqual(["one", "two"]);
    expect(store.bodies).toEqual([]);
    expect(drops).toEqual([["rejected", 1]]);
  });

  test.each([429, 502, 503, 504])("stops and keeps the body on a retryable %i", async (status) => {
    const store = new FakeStore();
    store.seed("one", "two");
    const { fetch, bodies } = scriptedFetch(status);
    const { drops } = create({ store: Promise.resolve(store), fetch });
    await settled();

    expect(bodies).toEqual(["one"]);
    expect(store.bodies.map((body) => body.body)).toEqual(["one", "two"]);
    expect(drops).toEqual([]);
  });

  test("stops and keeps the body on a network error", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const { fetch, requests } = manualFetch();
    create({ store: Promise.resolve(store), fetch });
    await settled();

    requests[0]?.fail(new TypeError("Failed to fetch"));
    await settled();

    expect(requests).toHaveLength(1);
    expect(store.bodies).toHaveLength(2);
  });

  test("stops and keeps the body when fetch or the headers thunk throws", async () => {
    const store = new FakeStore();
    store.seed("one");
    create({
      store: Promise.resolve(store),
      fetch: () => {
        throw new TypeError("bad init");
      },
    });
    create({
      store: Promise.resolve(store),
      headers: () => {
        throw new Error("no token");
      },
    });
    await settled();

    expect(store.bodies).toHaveLength(1);
  });

  test("cancels an unread response body, swallowing a rejected cancel", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const cancel = vi.fn(() => Promise.reject(new Error("already read")));
    const fetch: DeliveryFetch = () => Promise.resolve(response(200, { cancel }));
    create({ store: Promise.resolve(store), fetch });
    await settled();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(store.bodies).toEqual([]);
  });

  test("ends when a body it sent is read back, so a delete that did not happen is not looped on", async () => {
    const store = new FakeStore();
    store.seed("one");
    store.forgetDeletes = true;
    const { fetch, bodies } = scriptedFetch();
    create({ store: Promise.resolve(store), fetch });
    await settled();

    expect(bodies).toEqual(["one"]);
  });

  test("ends quietly when reading the store rejects, and can run again", async () => {
    const store = new FakeStore();
    store.seed("one");
    const oldest = store.oldest.bind(store);
    store.oldest = () => Promise.reject(new Error("broken"));
    const window = new FakeWindow();
    const { fetch, bodies } = scriptedFetch();
    create({ store: Promise.resolve(store), fetch, window });
    await settled();
    expect(bodies).toEqual([]);

    store.oldest = oldest;
    window.fire("online");
    await settled();

    expect(bodies).toEqual(["one"]);
  });

  test("runs on online, and not twice at once", async () => {
    const store = new FakeStore();
    const window = new FakeWindow();
    const { fetch, requests } = manualFetch();
    const { queue } = create({ store: Promise.resolve(store), fetch, window });
    await settled();
    expect(requests).toEqual([]);

    queue.undelivered(entries("a"), "retries-exhausted");
    queue.undelivered(entries("b"), "retries-exhausted");
    await settled();
    window.fire("online");
    window.fire("online");
    await settled();
    window.fire("online");
    await settled();

    expect(requests.map((request) => request.init.body)).toEqual(['["a"]']);
    requests[0]?.answer(response(200));
    await settled();
    expect(requests.map((request) => request.init.body)).toEqual(['["a"]', '["b"]']);
    requests[1]?.answer(response(200));
    await settled();

    expect(store.bodies).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  test("runs once the store opens, not before", async () => {
    const open = deferred<OfflineStore | undefined>();
    const store = new FakeStore();
    store.seed("one");
    const window = new FakeWindow();
    const { fetch, bodies } = scriptedFetch();
    create({ store: open.promise, fetch, window });

    window.fire("online");
    await settled();
    expect(bodies).toEqual([]);

    open.resolve(store);
    await settled();

    expect(bodies).toEqual(["one"]);
  });

  test("defaults fetch to globalThis.fetch, looked up at each request", async () => {
    const store = new FakeStore();
    store.seed("one");
    const { fetch, bodies } = scriptedFetch();
    vi.stubGlobal("fetch", fetch);
    create({ store: Promise.resolve(store), fetch: undefined });
    await settled();

    expect(bodies).toEqual(["one"]);
  });
});

describe("close", () => {
  test("removes the online listener", async () => {
    const window = new FakeWindow();
    const { queue } = create({ window });
    expect(window.count("online")).toBe(1);

    queue.close();
    queue.close();

    expect(window.count("online")).toBe(0);
  });

  test("aborts the replay in flight and starts no further one, keeping the bodies", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const window = new FakeWindow();
    const { fetch, requests } = manualFetch();
    const { queue } = create({ store: Promise.resolve(store), fetch, window });
    await settled();

    queue.close();
    expect(requests[0]?.init.signal.aborted).toBe(true);
    requests[0]?.fail(requests[0].init.signal.reason);
    window.fire("online");
    await settled();

    expect(requests).toHaveLength(1);
    expect(store.bodies).toHaveLength(2);
  });

  test("ends a replay after the body it was sending", async () => {
    const store = new FakeStore();
    store.seed("one", "two");
    const { fetch, requests } = manualFetch();
    const { queue } = create({ store: Promise.resolve(store), fetch });
    await settled();

    queue.close();
    requests[0]?.answer(response(200));
    await settled();

    expect(requests).toHaveLength(1);
    expect(store.bodies.map((body) => body.body)).toEqual(["two"]);
  });

  test("before the store opens, prevents the replay at open", async () => {
    const open = deferred<OfflineStore | undefined>();
    const store = new FakeStore();
    store.seed("one");
    const { fetch, bodies } = scriptedFetch();
    const { queue } = create({ store: open.promise, fetch });

    queue.close();
    open.resolve(store);
    await settled();

    expect(bodies).toEqual([]);
  });

  test("still saves later writes, and never closes the store", async () => {
    const { queue, store } = create({ fetch: manualFetch().fetch });
    await settled();

    queue.close();
    queue.undelivered(entries("a"), "closed");
    await settled();

    expect(store.bodies).toHaveLength(1);
    expect(store.calls).not.toContain("close");
  });

  test("works with no window", () => {
    const { queue } = create({ window: undefined });

    expect(() => queue.close()).not.toThrow();
  });
});

describe("settle", () => {
  test("resolves true at once with no write pending", async () => {
    const { queue } = create();

    expect(await queue.settle(0)).toBe(true);
  });

  test("resolves true once the pending writes finish within the timeout", async () => {
    const time = createManualTime();
    const store = new FakeStore();
    const put = deferred<PutOutcome>();
    store.put = () => put.promise;
    const { queue } = create({ store: Promise.resolve(store), scheduler: time.scheduler });
    await settled();

    queue.undelivered(entries("a"), "closed");
    const result = queue.settle(1000);
    await time.advance(500);
    put.resolve("stored");

    expect(await result).toBe(true);
    expect(time.pendingSleeps).toBe(0);
  });

  test("waits for writes held until the store opens", async () => {
    const time = createManualTime();
    const open = deferred<OfflineStore | undefined>();
    const { queue, drops } = create({ store: open.promise, scheduler: time.scheduler });

    queue.undelivered(entries("a"), "closed");
    const result = queue.settle(1000);
    open.resolve(undefined);

    expect(await result).toBe(true);
    expect(drops).toEqual([["closed", 1]]);
  });

  test("resolves false when a write is still pending at the timeout, and true once it is done", async () => {
    const time = createManualTime();
    const store = new FakeStore();
    const put = deferred<PutOutcome>();
    store.put = () => put.promise;
    const { queue } = create({ store: Promise.resolve(store), scheduler: time.scheduler });
    await settled();

    queue.undelivered(entries("a"), "closed");
    const result = queue.settle(1000);
    await time.advance(1000);

    expect(await result).toBe(false);
    put.resolve("stored");
    await settled();
    expect(await queue.settle(0)).toBe(true);
  });

  test("reads a negative timeout as no time at all", async () => {
    const time = createManualTime();
    const open = deferred<OfflineStore | undefined>();
    const { queue } = create({ store: open.promise, scheduler: time.scheduler });

    queue.undelivered(entries("a"), "closed");
    const result = queue.settle(-5);
    await time.advance(0);

    expect(await result).toBe(false);
  });

  test("does not wait for a replay", async () => {
    const time = createManualTime();
    const store = new FakeStore();
    store.seed("one");
    const { fetch, requests } = manualFetch();
    const { queue } = create({ store: Promise.resolve(store), fetch, scheduler: time.scheduler });
    await settled();
    expect(requests).toHaveLength(1);

    expect(await queue.settle(10)).toBe(true);
  });

  test("defaults the scheduler to the system scheduler", async () => {
    const open = deferred<OfflineStore | undefined>();
    const { queue } = create({ store: open.promise, scheduler: undefined });

    queue.undelivered(entries("a"), "closed");

    expect(await queue.settle(1)).toBe(false);
  });
});

describe("idle", () => {
  test("resolves with no write pending", async () => {
    const { queue } = create();

    await expect(queue.idle()).resolves.toBeUndefined();
  });

  test("resolves only once the pending writes finish", async () => {
    const store = new FakeStore();
    const put = deferred<PutOutcome>();
    store.put = () => put.promise;
    const { queue } = create({ store: Promise.resolve(store) });
    await settled();
    let done = false;

    queue.undelivered(entries("a"), "closed");
    void queue.idle().then(() => {
      done = true;
    });
    await settled();
    expect(done).toBe(false);

    put.resolve("stored");
    await settled();
    expect(done).toBe(true);
  });

  test("also waits for a write issued while it waits", async () => {
    const store = new FakeStore();
    const first = deferred<PutOutcome>();
    const second = deferred<PutOutcome>();
    let calls = 0;
    store.put = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };
    const { queue } = create({ store: Promise.resolve(store) });
    await settled();
    let done = false;

    queue.undelivered(entries("a"), "closed");
    void queue.idle().then(() => {
      done = true;
    });
    queue.undelivered(entries("b"), "closed");
    await settled();
    first.resolve("stored");
    await settled();
    expect(done).toBe(false);

    second.resolve("stored");
    await settled();
    expect(done).toBe(true);
  });
});

describe("isOffline", () => {
  test("is true when the navigator reports onLine false", () => {
    expect(create({ navigator: { onLine: false } }).queue.isOffline()).toBe(true);
  });

  test.each([
    ["onLine true", { onLine: true }],
    ["onLine absent", {}],
    ["onLine not a boolean", { onLine: "no" }],
    ["no navigator", undefined],
  ])("is false with %s", (_name, navigator) => {
    expect(create({ navigator }).queue.isOffline()).toBe(false);
  });
});
