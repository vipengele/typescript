import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "../../event";
import { createEventQueue, estimateSize, type QueueLimits, resourceKey } from "./queue";

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

function aResource(overrides: Partial<Resource> = {}): Resource {
  return Object.freeze({
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
    ...overrides,
  });
}

const SIZE = estimateSize(anEvent("m"));

const ROOMY: QueueLimits = { maxQueueEvents: 100, maxQueueBytes: 1_000_000, maxBatchEvents: 100, maxBatchBytes: 100_000 };

describe("estimateSize", () => {
  it("counts the UTF-8 bytes of the event's JSON, not its UTF-16 length", () => {
    expect(estimateSize(anEvent("é"))).toBe(SIZE + 1);
    expect(estimateSize(anEvent("€"))).toBe(SIZE + 2);
    expect(estimateSize(anEvent("m"))).toBe(JSON.stringify(anEvent("m")).length);
  });
});

describe("resourceKey", () => {
  it("is equal for distinct but structurally equal Resources", () => {
    expect(resourceKey(aResource())).toBe(resourceKey(aResource()));
  });

  it("tells an absent value apart from every string, the empty string included", () => {
    expect(resourceKey(aResource({ "service.dist": undefined }))).not.toBe(resourceKey(aResource({ "service.dist": "" })));
    expect(resourceKey(aResource({ "service.dist": undefined }))).not.toBe(resourceKey(aResource({ "service.dist": "null" })));
  });

  it("tells the same value under different keys apart", () => {
    expect(resourceKey(aResource({ "browser.name": "x", "browser.version": undefined }))).not.toBe(
      resourceKey(aResource({ "browser.name": undefined, "browser.version": "x" })),
    );
  });
});

describe("createEventQueue", () => {
  it("starts empty and takes no batch", () => {
    const queue = createEventQueue(ROOMY);

    expect(queue.size).toBe(0);
    expect(queue.bytes).toBe(0);
    expect(queue.isEmpty).toBe(true);
    expect(queue.takeBatch()).toBeUndefined();
  });

  it("tracks the count and estimated bytes it holds", () => {
    const queue = createEventQueue(ROOMY);

    expect(queue.push(anEvent(), aResource())).toBeUndefined();
    expect(queue.push(anEvent(), aResource())).toBeUndefined();

    expect(queue.size).toBe(2);
    expect(queue.bytes).toBe(2 * SIZE);
    expect(queue.isEmpty).toBe(false);
  });

  it("drops the arriving event as queue-full once maxQueueEvents are held, keeping what it holds", () => {
    const queue = createEventQueue({ ...ROOMY, maxQueueEvents: 2 });
    const first = anEvent("a");
    const second = anEvent("b");

    queue.push(first, aResource());
    queue.push(second, aResource());

    expect(queue.push(anEvent("c"), aResource())).toBe("queue-full");
    expect(queue.size).toBe(2);
    expect(queue.drain()).toEqual([first, second]);
  });

  it("drops the arriving event as queue-full when it would take the queue past maxQueueBytes", () => {
    const queue = createEventQueue({ ...ROOMY, maxQueueBytes: 2 * SIZE + 1 });

    expect(queue.push(anEvent(), aResource())).toBeUndefined();
    expect(queue.push(anEvent(), aResource())).toBeUndefined();
    expect(queue.push(anEvent(), aResource())).toBe("queue-full");
    expect(queue.bytes).toBe(2 * SIZE);
  });

  it("accepts an event that fills maxQueueBytes exactly", () => {
    const queue = createEventQueue({ ...ROOMY, maxQueueBytes: 2 * SIZE });

    queue.push(anEvent(), aResource());

    expect(queue.push(anEvent(), aResource())).toBeUndefined();
  });

  it("accepts again once a batch frees room", () => {
    const queue = createEventQueue({ ...ROOMY, maxQueueEvents: 1 });
    queue.push(anEvent(), aResource());
    expect(queue.push(anEvent(), aResource())).toBe("queue-full");

    queue.takeBatch();

    expect(queue.push(anEvent(), aResource())).toBeUndefined();
  });

  it("drops a single event larger than maxBatchBytes as too-large before it takes queue space", () => {
    const queue = createEventQueue({ ...ROOMY, maxBatchBytes: SIZE + 5 });

    expect(queue.push(anEvent("x".repeat(7)), aResource())).toBe("too-large");
    expect(queue.isEmpty).toBe(true);
    expect(queue.push(anEvent("x".repeat(6)), aResource())).toBeUndefined();
  });

  it("reports too-large ahead of queue-full", () => {
    const queue = createEventQueue({ ...ROOMY, maxQueueEvents: 1, maxBatchBytes: SIZE });
    queue.push(anEvent(), aResource());

    expect(queue.push(anEvent("xx"), aResource())).toBe("too-large");
  });

  it("drops an event JSON.stringify throws on as unsendable", () => {
    const queue = createEventQueue(ROOMY);
    const withBigInt = { ...anEvent(), attributes: { n: 1n } } as unknown as ErrorEvent;
    const cyclic = anEvent() as ErrorEvent & { self?: unknown };
    cyclic.self = cyclic;

    expect(queue.push(withBigInt, aResource())).toBe("unsendable");
    expect(queue.push(cyclic, aResource())).toBe("unsendable");
    expect(queue.isEmpty).toBe(true);
  });

  it("takes events in order with the Resource they were pushed with", () => {
    const queue = createEventQueue(ROOMY);
    const resource = aResource();
    const events = [anEvent("a"), anEvent("b"), anEvent("c")];
    for (const event of events) {
      queue.push(event, resource);
    }

    const batch = queue.takeBatch();

    expect(batch?.events).toEqual(events);
    expect(batch?.events[0]).toBe(events[0]);
    expect(batch?.resource).toBe(resource);
    expect(queue.isEmpty).toBe(true);
    expect(queue.bytes).toBe(0);
  });

  it("cuts a batch at maxBatchEvents", () => {
    const queue = createEventQueue({ ...ROOMY, maxBatchEvents: 2 });
    for (const message of ["a", "b", "c", "d", "e"]) {
      queue.push(anEvent(message), aResource());
    }

    expect(queue.takeBatch()?.events.map((event) => event.message)).toEqual(["a", "b"]);
    expect(queue.takeBatch()?.events.map((event) => event.message)).toEqual(["c", "d"]);
    expect(queue.takeBatch()?.events.map((event) => event.message)).toEqual(["e"]);
    expect(queue.takeBatch()).toBeUndefined();
  });

  it("cuts a batch before the event that would take it past maxBatchBytes", () => {
    const queue = createEventQueue({ ...ROOMY, maxBatchBytes: 2 * SIZE + 1 });
    for (const message of ["a", "b", "c", "d"]) {
      queue.push(anEvent(message), aResource());
    }

    expect(queue.takeBatch()?.events.map((event) => event.message)).toEqual(["a", "b"]);
    expect(queue.bytes).toBe(2 * SIZE);
    expect(queue.takeBatch()?.events.map((event) => event.message)).toEqual(["c", "d"]);
  });

  it("fills a batch to maxBatchBytes exactly", () => {
    const queue = createEventQueue({ ...ROOMY, maxBatchBytes: 3 * SIZE });
    for (const message of ["a", "b", "c", "d"]) {
      queue.push(anEvent(message), aResource());
    }

    expect(queue.takeBatch()?.events).toHaveLength(3);
  });

  it("batches distinct but structurally equal frozen Resources together", () => {
    const queue = createEventQueue(ROOMY);
    const first = aResource();
    const second = aResource();
    expect(first).not.toBe(second);
    expect(Object.isFrozen(second)).toBe(true);

    queue.push(anEvent("a"), first);
    queue.push(anEvent("b"), second);

    const batch = queue.takeBatch();
    expect(batch?.events.map((event) => event.message)).toEqual(["a", "b"]);
    expect(batch?.resource).toBe(first);
  });

  it("splits at a Resource that differs, and never reorders events across Resources", () => {
    const queue = createEventQueue(ROOMY);
    const shop = aResource();
    const admin = aResource({ "service.name": "admin" });

    queue.push(anEvent("a"), shop);
    queue.push(anEvent("b"), admin);
    queue.push(anEvent("c"), aResource());

    expect(queue.takeBatch()).toEqual({ events: [anEvent("a")], resource: shop });
    expect(queue.takeBatch()).toEqual({ events: [anEvent("b")], resource: admin });
    expect(queue.takeBatch()?.events).toEqual([anEvent("c")]);
  });

  it("drains every event held, in order, and empties the queue", () => {
    const queue = createEventQueue(ROOMY);
    queue.push(anEvent("a"), aResource());
    queue.push(anEvent("b"), aResource({ "service.name": "admin" }));

    expect(queue.drain().map((event) => event.message)).toEqual(["a", "b"]);
    expect(queue.isEmpty).toBe(true);
    expect(queue.bytes).toBe(0);
    expect(queue.drain()).toEqual([]);
  });
});
