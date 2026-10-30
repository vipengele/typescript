import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, test } from "vitest";
import { createDelivery, type DeliveryOptions, type DeliveryRequest, type DeliveryResponse, type DropReason } from "./delivery";
import { detectLifecycleTargets, largestFittingPrefix, UNLOAD_BUDGET_BYTES, utf8ByteLength, watchUnload } from "./unload";

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

/** A `Document` stand-in: an event target whose `visibilityState` a test sets. */
function fakeDocument(visibilityState = "visible") {
  return Object.assign(new EventTarget(), { visibilityState });
}

/** An event target that counts the listeners it holds. */
function countingTarget() {
  const target = new EventTarget();
  let listeners = 0;
  return {
    addEventListener(type: string, listener: () => void) {
      listeners += 1;
      target.addEventListener(type, listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners -= 1;
      target.removeEventListener(type, listener);
    },
    get listeners() {
      return listeners;
    },
  };
}

/** Never settles on its own; rejects with the signal's reason once the attempt is aborted. */
function hang(_url: string, init: DeliveryRequest): Promise<DeliveryResponse> {
  return new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type Fetch = (url: string, init: DeliveryRequest) => Promise<DeliveryResponse>;

/** Answers the first call with `first` and every later one with 200. */
function harness(first: Fetch | undefined, overrides: Partial<DeliveryOptions<string>> = {}) {
  const time = createManualTime(0);
  const window = new EventTarget();
  const document = fakeDocument();
  const calls: { url: string; init: DeliveryRequest }[] = [];
  const drops: [DropReason, number][] = [];
  let pending = first;
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    const responder = pending;
    pending = undefined;
    return responder === undefined ? Promise.resolve(new Response(null, { status: 200 })) : responder(url, init);
  };
  const delivery = createDelivery<string>({
    url: "https://collector.example/v1/logs",
    fetch,
    clock: time.clock,
    scheduler: time.scheduler,
    headers: { authorization: "Bearer t" },
    encode: (entries) => JSON.stringify(entries.map((entry) => entry.item)),
    onDrop: (reason, count) => {
      drops.push([reason, count]);
    },
    lifecycle: { window, document },
    ...overrides,
  });
  const enqueueAll = (items: string[]): void => {
    for (const item of items) {
      delivery.enqueue(item, RESOURCE);
    }
  };
  const pagehide = (): void => {
    window.dispatchEvent(new Event("pagehide"));
  };
  const hide = (): void => {
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return { time, window, document, calls, drops, delivery, enqueueAll, pagehide, hide };
}

describe("largestFittingPrefix", () => {
  const encode = (entries: ReadonlyArray<string>): string => entries.join("");

  test("doubles the count up to every entry when every entry fits", () => {
    const tried: number[] = [];
    const prefix = largestFittingPrefix(
      ["aa", "bb", "cc"],
      (entries) => {
        tried.push(entries.length);
        return encode(entries);
      },
      6,
    );
    expect(prefix).toEqual({ count: 3, body: "aabbcc" });
    expect(tried).toEqual([1, 2, 3]);
  });

  test("doubles the count until a prefix does not fit, then bisects down to the largest that fits", () => {
    const tried: number[] = [];
    const prefix = largestFittingPrefix(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      (entries) => {
        tried.push(entries.length);
        return encode(entries);
      },
      4,
    );
    expect(prefix).toEqual({ count: 4, body: "abcd" });
    expect(tried).toEqual([1, 2, 4, 8, 6, 5]);
  });

  test("never encodes the whole of a backlog far over budget", () => {
    const entries = Array.from({ length: 2048 }, () => "x".repeat(100));
    const tried: number[] = [];
    const prefix = largestFittingPrefix(
      entries,
      (slice) => {
        tried.push(slice.length);
        return encode(slice);
      },
      UNLOAD_BUDGET_BYTES,
    );
    expect(prefix.count).toBe(Math.floor(UNLOAD_BUDGET_BYTES / 100));
    expect(Math.max(...tried)).toBeLessThan(2 * prefix.count);
    expect(tried.reduce((sum, count) => sum + count, 0)).toBeLessThan(16 * prefix.count);
  });

  test("gives no entries and encodes nothing for an empty queue", () => {
    const tried: number[] = [];
    const prefix = largestFittingPrefix(
      [],
      (slice) => {
        tried.push(slice.length);
        return encode(slice);
      },
      4,
    );
    expect(prefix).toEqual({ count: 0, body: "" });
    expect(tried).toEqual([]);
  });

  test("gives no entries when even the oldest one does not fit", () => {
    expect(largestFittingPrefix(["toolong", "b"], encode, 3)).toEqual({ count: 0, body: "" });
  });

  test("measures the encoding in UTF-8 bytes", () => {
    expect(utf8ByteLength("é€😀")).toBe(2 + 3 + 4);
    expect(largestFittingPrefix(["é", "é"], encode, 3)).toEqual({ count: 1, body: "é" });
  });
});

describe("detectLifecycleTargets", () => {
  test("finds a window-like scope and its document", () => {
    const document = fakeDocument();
    const scope = Object.assign(new EventTarget(), { onpagehide: null, document });
    expect(detectLifecycleTargets(scope)).toEqual({ window: scope, document });
  });

  test("leaves out an event target with no pagehide handler slot, and a document that is no event target", () => {
    const scope = Object.assign(new EventTarget(), { document: { visibilityState: "visible" } });
    expect(detectLifecycleTargets(scope)).toEqual({ window: undefined, document: undefined });
  });

  test("finds nothing on a plain object", () => {
    expect(detectLifecycleTargets({})).toEqual({ window: undefined, document: undefined });
    expect(detectLifecycleTargets({ addEventListener() {} })).toEqual({ window: undefined, document: undefined });
  });

  test("reads globalThis by default", () => {
    expect(detectLifecycleTargets()).toEqual(detectLifecycleTargets(globalThis));
  });
});

describe("watchUnload", () => {
  test("calls back on pagehide and on visibilitychange to hidden, not to visible", () => {
    const window = new EventTarget();
    const document = fakeDocument();
    let calls = 0;
    watchUnload({ window, document }, () => {
      calls += 1;
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(0);
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(calls).toBe(2);
  });

  test("removes both listeners, once", () => {
    const window = countingTarget();
    const document = countingTarget();
    const unwatch = watchUnload({ window, document }, () => {});
    expect([window.listeners, document.listeners]).toEqual([1, 1]);
    unwatch();
    unwatch();
    expect([window.listeners, document.listeners]).toEqual([0, 0]);
  });

  test("watches nothing without targets", () => {
    expect(() => watchUnload({}, () => {})()).not.toThrow();
  });
});

describe("createDelivery unload drain", () => {
  test("aborts the attempt in flight and sends it with the buffer as one keepalive request", async () => {
    const { calls, drops, enqueueAll, pagehide, time } = harness(hang, { limits: { maxBatchSize: 2 } });
    enqueueAll(["a", "b", "c"]);
    await tick();
    expect(calls).toHaveLength(1);
    pagehide();
    expect(calls[0]?.init.signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://collector.example/v1/logs");
    expect(calls[1]?.init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: '["a","b","c"]',
      keepalive: true,
    });
    expect(calls[1]?.init.signal.aborted).toBe(false);
    await tick();
    await time.advance(60_000);
    expect(calls).toHaveLength(2);
    expect(drops).toEqual([]);
    expect(time.pendingSleeps).toBe(0);
  });

  test("sends the largest oldest prefix within the budget and drops the rest as unload-budget", async () => {
    const big = "x".repeat(20_000);
    const { calls, drops, enqueueAll, hide } = harness(undefined, { limits: { maxBatchSize: 10 } });
    enqueueAll(["1", "2", "3", "4", "5"].map((n) => n + big));
    hide();
    expect(calls).toHaveLength(1);
    const body = calls[0]?.init.body as string;
    expect(JSON.parse(body)).toEqual(["1", "2", "3"].map((n) => n + big));
    expect(utf8ByteLength(body)).toBeLessThanOrEqual(UNLOAD_BUDGET_BYTES);
    expect(drops).toEqual([["unload-budget", 2]]);
  });

  test("drops everything as unload-budget, sending nothing, when the oldest entry alone is over budget", () => {
    const { calls, drops, enqueueAll, pagehide } = harness(undefined);
    enqueueAll(["é".repeat(40_000), "b"]);
    pagehide();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([["unload-budget", 2]]);
  });

  test("does nothing when nothing is buffered or in flight, or on a visibilitychange to visible", () => {
    const { calls, drops, document, enqueueAll, pagehide } = harness(undefined);
    pagehide();
    enqueueAll(["a"]);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([]);
  });

  test("does nothing on the pagehide that follows the visibilitychange it already drained for", async () => {
    const { calls, drops, enqueueAll, hide, pagehide } = harness(hang, { limits: { maxBatchSize: 1 } });
    enqueueAll(["a"]);
    await tick();
    hide();
    pagehide();
    expect(calls.map((call) => call.init.body)).toEqual(['["a"]', '["a"]']);
    await tick();
    expect(drops).toEqual([]);
  });

  test("keeps exporting after an unload drain", async () => {
    const { calls, delivery, enqueueAll, pagehide } = harness(undefined);
    enqueueAll(["a"]);
    pagehide();
    enqueueAll(["b"]);
    await expect(delivery.flush()).resolves.toBe(true);
    expect(calls.map((call) => [call.init.body, call.init.keepalive])).toEqual([
      ['["a"]', true],
      ['["b"]', undefined],
    ]);
  });

  test("drops everything as rejected when encode throws", () => {
    const encode = (): string => {
      throw new Error("cannot encode");
    };
    const { calls, drops, enqueueAll, pagehide } = harness(undefined, { encode });
    enqueueAll(["a", "b"]);
    pagehide();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([["rejected", 2]]);
  });

  test("drops everything as rejected when the headers thunk throws", () => {
    const headers = (): Record<string, string> => {
      throw new Error("no token");
    };
    const { calls, drops, enqueueAll, pagehide } = harness(undefined, { headers });
    enqueueAll(["a"]);
    pagehide();
    expect(calls).toHaveLength(0);
    expect(drops).toEqual([["rejected", 1]]);
  });

  test("swallows a fetch that throws synchronously or rejects", async () => {
    const throwing = harness(undefined, {
      fetch: () => {
        throw new TypeError("fetch is not available");
      },
    });
    throwing.enqueueAll(["a"]);
    expect(() => throwing.pagehide()).not.toThrow();
    const rejecting = harness(() => Promise.reject(new TypeError("network down")));
    rejecting.enqueueAll(["a"]);
    rejecting.pagehide();
    expect(rejecting.calls).toHaveLength(1);
    await tick();
    expect([...throwing.drops, ...rejecting.drops]).toEqual([]);
  });

  test("close removes both listeners once it has flushed", async () => {
    const window = countingTarget();
    const document = countingTarget();
    const { delivery } = harness(undefined, { lifecycle: { window, document } });
    expect([window.listeners, document.listeners]).toEqual([1, 1]);
    await delivery.close();
    expect([window.listeners, document.listeners]).toEqual([0, 0]);
  });

  test("watches nothing when given no targets", () => {
    const { calls, enqueueAll, pagehide } = harness(undefined, { lifecycle: {} });
    enqueueAll(["a"]);
    pagehide();
    expect(calls).toHaveLength(0);
  });
});
