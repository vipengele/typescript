import type { SerializeErrorOptions } from "@vipengele/ts-core-common";
import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "./event";
import { createReporter } from "./reporter";
import { createTestTransport } from "./transports/test-transport";

// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const CUT = "…[truncated]";

const RESOURCE_KEYS = [
  "service.name",
  "service.version",
  "service.dist",
  "deployment.environment.name",
  "process.runtime.name",
  "process.runtime.version",
  "os.type",
  "os.version",
  "browser.name",
  "browser.version",
  "device.type",
];

const EVENT_ID = /^[0-9a-f]{32}$/;

// The realm's root is the default scope's parent. Its attribute bag is put back after every test,
// so a Resource a test sets never reaches the next one.
const ATTRIBUTES = Symbol.for("vipengele:scope:attributes");
const realmRoot = (Scope.current() as unknown as Record<symbol, unknown>)[Symbol.for("vipengele:scope:parent")] as Record<symbol, unknown>;
const originalAttributes = realmRoot[ATTRIBUTES];

/** Gives the realm's root a Resource with every key unset. */
function clearResource(): void {
  const bag = Object.create(null) as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    bag[key] = undefined;
  }
  realmRoot[ATTRIBUTES] = Object.freeze(bag);
}

function onlyEvent(events: readonly ErrorEvent[]): ErrorEvent {
  expect(events).toHaveLength(1);
  return events[0] as ErrorEvent;
}

function aReporter() {
  const transport = createTestTransport();
  return { transport, reporter: createReporter((b) => b.transport(transport)) };
}

afterEach(() => {
  realmRoot[ATTRIBUTES] = originalAttributes;
  vi.restoreAllMocks();
});

describe("scope attributes in an event", () => {
  it("lays the scope's attributes beneath the call's, the call's value winning a shared key", () => {
    const { transport, reporter } = aReporter();

    Scope.isolated("request", { shared: "scope", scopeOnly: 1 }, () => {
      reporter.captureException(new Error("hello"), { attributes: { shared: "call", callOnly: 2 } });
    });

    expect(onlyEvent(transport.events).attributes).toEqual({ shared: "call", scopeOnly: 1, callOnly: 2 });
  });

  it("takes the scope's attributes from every enclosing scope up to the root, the innermost winning", () => {
    const { transport, reporter } = aReporter();

    Scope.isolated("request", { outer: "outer", both: "outer" }, () => {
      Scope.inherit("step", { inner: "inner", both: "inner" }, () => {
        reporter.captureMessage("hello");
      });
    });

    expect(onlyEvent(transport.events).attributes).toEqual({ outer: "outer", inner: "inner", both: "inner" });
  });

  it("keeps the call's own attributes intact when the scope holds more attributes than the breadth bound", () => {
    const { transport, reporter } = aReporter();
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`key${index}`, index]));

    Scope.isolated("request", many, () => {
      reporter.captureException(new Error("hello"), { attributes: { callOnly: "kept", key0: "call" } });
    });

    const attributes = onlyEvent(transport.events).attributes;
    expect(attributes.callOnly).toBe("kept");
    expect(attributes.key0).toBe("call");
    expect(Object.keys(attributes).length).toBeGreaterThan(100);
  });

  it("keeps the scope's truncation marker under a free key when the call's attributes are truncated too", () => {
    const { transport, reporter } = aReporter();
    const many = (prefix: string) => Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`${prefix}${index}`, index]));

    Scope.isolated("request", many("scope"), () => {
      reporter.captureException(new Error("hello"), { attributes: { "…#1": "taken", ...many("call") } });
    });

    const attributes = onlyEvent(transport.events).attributes;
    expect(attributes["…"]).toMatch(/^\[Truncated: \d+ more\]$/);
    expect(attributes["…#1"]).toBe("taken");
    expect(attributes["…#2"]).toBe("[Truncated: 50 more]");
  });

  it("leaves the scope's truncation marker under its own key when the call's attributes are not truncated", () => {
    const { transport, reporter } = aReporter();
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`scope${index}`, index]));

    Scope.isolated("request", many, () => {
      reporter.captureException(new Error("hello"), { attributes: { callOnly: 1 } });
    });

    expect(onlyEvent(transport.events).attributes["…"]).toBe("[Truncated: 50 more]");
  });

  it("separates the attributes of two isolated scopes entered one after the other", () => {
    const { transport, reporter } = aReporter();

    Scope.isolated("first", { request: "a" }, () => {
      reporter.captureMessage("first");
    });
    Scope.isolated("second", { other: "b" }, () => {
      reporter.captureMessage("second");
    });

    expect(transport.events.map((event) => event.attributes)).toEqual([{ request: "a" }, { other: "b" }]);
  });

  it("separates the attributes of an isolated scope nested inside another", () => {
    const { transport, reporter } = aReporter();

    Scope.isolated("outer", { outer: true }, () => {
      Scope.isolated("inner", { inner: true }, () => {
        reporter.captureMessage("hello");
      });
    });

    expect(onlyEvent(transport.events).attributes).toEqual({ inner: true });
  });

  it("never carries the Resource's keys, even though the root holds them", () => {
    const { transport, reporter } = aReporter();

    Scope.isolated("request", { request: "a" }, () => {
      reporter.captureException(new Error("boom"), { attributes: { call: 1 } });
    });

    const attributes = onlyEvent(transport.events).attributes;
    for (const key of RESOURCE_KEYS) {
      expect(attributes).not.toHaveProperty(key);
    }
    expect(attributes).toEqual({ request: "a", call: 1 });
  });

  it("merges a null-prototype call attributes record with a null-prototype scope snapshot", () => {
    const { transport, reporter } = aReporter();
    const call = Object.create(null) as Record<string, unknown>;
    call.shared = "call";
    call.callOnly = true;

    Scope.isolated("request", { shared: "scope", scopeOnly: true }, () => {
      reporter.captureException(new Error("hello"), { attributes: call });
    });

    expect(onlyEvent(transport.events).attributes).toEqual({ shared: "call", scopeOnly: true, callOnly: true });
  });

  it("keeps a __proto__ attribute a plain key instead of replacing the prototype of the merged record", () => {
    const { transport, reporter } = aReporter();
    const call = JSON.parse('{"__proto__": {"polluted": true}, "plain": 1}') as Record<string, unknown>;

    Scope.isolated("request", { scopeOnly: 1 }, () => {
      reporter.captureException(new Error("hello"), { attributes: call });
    });

    const attributes = onlyEvent(transport.events).attributes;
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(attributes).not.toHaveProperty("polluted");
    expect(Object.keys(attributes)).toEqual(expect.arrayContaining(["scopeOnly", "plain"]));
  });

  it("still delivers the event with only the call's attributes when reading the scope throws", () => {
    const { transport, reporter } = aReporter();
    vi.spyOn(Scope, "current").mockImplementation(() => {
      throw new Error("scope unreadable");
    });

    const id = reporter.captureException(new Error("hello"), { attributes: { callOnly: 1 } });

    const event = onlyEvent(transport.events);
    expect(event.id).toBe(id);
    expect(event.attributes).toEqual({ callOnly: 1 });
  });
});

describe("the Resource an event is sent with", () => {
  it("hands send the Resource Scope.resource() returns at capture, alongside the event", () => {
    const sent: [ErrorEvent, Resource][] = [];
    const reporter = createReporter((b) =>
      b.transport({
        send: (event, resource) => {
          sent.push([event, resource]);
        },
        flush: async () => true,
        close: async () => true,
      }),
    );

    const id = reporter.captureMessage("hello");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.[0].id).toBe(id);
    expect(sent[0]?.[1]).toEqual(Scope.resource());
    expect(Object.isFrozen(sent[0]?.[1])).toBe(true);
  });

  it("carries a Resource set through Scope.setResource on the next event after the Reporter exists", () => {
    // The realm's root is the default scope's parent; its attribute bag is put back afterwards so
    // the Resource set here never reaches another test.
    const defaultScope = Scope.current() as unknown as Record<symbol, unknown>;
    const root = defaultScope[Symbol.for("vipengele:scope:parent")] as Record<symbol, unknown>;
    const attributes = Symbol.for("vipengele:scope:attributes");
    const original = root[attributes];
    const { transport, reporter } = aReporter();

    try {
      reporter.captureMessage("before");
      Scope.setResource({ "service.name": "checkout", "service.version": "1.2.3" });
      reporter.captureMessage("after");
      expect(transport.resources[1]).toEqual(Scope.resource());
    } finally {
      root[attributes] = original;
    }

    expect(transport.resources).toHaveLength(2);
    expect(transport.resources[0]?.["service.name"]).not.toBe("checkout");
    expect(transport.resources[1]?.["service.name"]).toBe("checkout");
    expect(transport.resources[1]?.["service.version"]).toBe("1.2.3");
  });

  it("still delivers the event, with every Resource key undefined, when reading the Resource throws", () => {
    const { transport, reporter } = aReporter();
    vi.spyOn(Scope, "resource").mockImplementation(() => {
      throw new Error("resource unreadable");
    });

    const id = reporter.captureException(new Error("hello"), { attributes: { callOnly: 1 } });

    expect(onlyEvent(transport.events).id).toBe(id);
    expect(transport.resources).toHaveLength(1);
    const resource = transport.resources[0] as Resource;
    expect(Object.keys(resource).sort()).toEqual([...RESOURCE_KEYS].sort());
    for (const key of RESOURCE_KEYS) {
      expect(resource[key as keyof Resource]).toBeUndefined();
    }
    expect(Object.isFrozen(resource)).toBe(true);
  });
});

describe("the enabled environments gate", () => {
  function aGatedReporter(environments: readonly string[], clock: () => number = () => 1) {
    const transport = createTestTransport();
    return { transport, reporter: createReporter((b) => b.transport(transport).clock(clock).enabledEnvironments(environments)) };
  }

  /** An error that counts every read of its `name`, `message` and `stack`, so a test sees whether normalization reached it. */
  function aWatchedError() {
    const read = vi.fn();
    const error = new Error("boom");
    for (const key of ["name", "message", "stack"] as const) {
      Object.defineProperty(error, key, {
        get: () => {
          read(key);
          return key;
        },
      });
    }
    return { error, read };
  }

  it("sends an event whose environment the list holds, with the Resource naming it", () => {
    Scope.setResource({ "deployment.environment.name": "production" });
    const { transport, reporter } = aGatedReporter(["staging", "production"]);

    const id = reporter.captureException(new Error("boom"));

    expect(onlyEvent(transport.events).id).toBe(id);
    expect(transport.resources[0]?.["deployment.environment.name"]).toBe("production");
  });

  it("drops an event whose environment the list does not hold before normalizing it, and still returns an id", () => {
    Scope.setResource({ "deployment.environment.name": "development" });
    const clock = vi.fn(() => 1);
    const { transport, reporter } = aGatedReporter(["production"], clock);
    const { error, read } = aWatchedError();

    const exceptionId = reporter.captureException(error, { attributes: { call: 1 } });
    const messageId = reporter.captureMessage("hello");

    expect(exceptionId).toMatch(EVENT_ID);
    expect(messageId).toMatch(EVENT_ID);
    expect(exceptionId).not.toBe(messageId);
    expect(read).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(transport.events).toEqual([]);
    expect(transport.resources).toEqual([]);
  });

  it("sends an event whose Resource has no environment", () => {
    clearResource();
    const { transport, reporter } = aGatedReporter(["production"]);

    reporter.captureMessage("hello");

    expect(onlyEvent(transport.events).message).toBe("hello");
    expect(transport.resources[0]?.["deployment.environment.name"]).toBeUndefined();
  });

  it("counts the empty string as an environment, dropping it unless the list holds it", () => {
    Scope.setResource({ "deployment.environment.name": "" });
    const dropped = aGatedReporter(["production"]);
    const kept = aGatedReporter(["", "production"]);

    dropped.reporter.captureMessage("hello");
    kept.reporter.captureMessage("hello");

    expect(dropped.transport.events).toEqual([]);
    expect(onlyEvent(kept.transport.events).message).toBe("hello");
    expect(kept.transport.resources[0]?.["deployment.environment.name"]).toBe("");
  });

  it("sends every event, whatever its environment, when no list is set", () => {
    Scope.setResource({ "deployment.environment.name": "anywhere" });
    const { transport, reporter } = aReporter();

    reporter.captureMessage("hello");

    expect(onlyEvent(transport.events).message).toBe("hello");
  });

  it("sends the event, with every Resource key undefined, when reading the Resource throws", () => {
    Scope.setResource({ "deployment.environment.name": "development" });
    const { transport, reporter } = aGatedReporter(["production"]);
    vi.spyOn(Scope, "resource").mockImplementation(() => {
      throw new Error("resource unreadable");
    });

    const id = reporter.captureMessage("hello");

    expect(onlyEvent(transport.events).id).toBe(id);
    expect(transport.resources[0]?.["deployment.environment.name"]).toBeUndefined();
  });

  it("follows a Scope.setResource from the next event on", () => {
    Scope.setResource({ "deployment.environment.name": "development" });
    const { transport, reporter } = aGatedReporter(["production"]);

    reporter.captureMessage("first");
    Scope.setResource({ "deployment.environment.name": "production" });
    reporter.captureMessage("second");
    Scope.setResource({ "deployment.environment.name": "development" });
    reporter.captureMessage("third");

    expect(onlyEvent(transport.events).message).toBe("second");
  });

  it("reads the Resource once per event, and sends the event with the Resource the gate read", () => {
    Scope.setResource({ "deployment.environment.name": "staging" });
    // The clock runs during enrichment, after the gate and before delivery.
    const clock = vi.fn(() => {
      Scope.setResource({ "deployment.environment.name": "production" });
      return 1;
    });
    const { transport, reporter } = aGatedReporter(["staging"], clock);
    const resource = vi.spyOn(Scope, "resource");

    reporter.captureMessage("first");

    expect(resource).toHaveBeenCalledOnce();
    expect(clock).toHaveBeenCalledOnce();
    expect(onlyEvent(transport.events).message).toBe("first");
    expect(transport.resources[0]?.["deployment.environment.name"]).toBe("staging");
    expect(transport.resources[0]).toBe(resource.mock.results[0]?.value);

    reporter.captureMessage("second");

    expect(resource).toHaveBeenCalledTimes(2);
    expect(clock).toHaveBeenCalledOnce();
    expect(transport.events).toHaveLength(1);
  });
});

describe("the limits an event is cut to", () => {
  function aLimitedReporter(limits: SerializeErrorOptions) {
    const transport = createTestTransport();
    return { transport, reporter: createReporter((b) => b.transport(transport).limits(limits)) };
  }

  function anErrorWithFrames(count: number, message = "boom"): Error {
    const error = new Error(message);
    const lines = Array.from({ length: count }, (_, index) => `    at fn${index} (/app/src/file.js:${index + 1}:1)`);
    error.stack = [`Error: ${message}`, ...lines].join("\n");
    return error;
  }

  it("cuts a message longer than maxStringLength and appends the truncation suffix", () => {
    const { transport, reporter } = aLimitedReporter({ maxStringLength: 5 });

    reporter.captureMessage("abcdefgh");

    expect(onlyEvent(transport.events).message).toBe(`abcde${CUT}`);
  });

  it("keeps a message exactly maxStringLength long as it is", () => {
    const { transport, reporter } = aLimitedReporter({ maxStringLength: 5 });

    reporter.captureMessage("abcde");

    expect(onlyEvent(transport.events).message).toBe("abcde");
  });

  it("keeps a message of 8192 code units and cuts one of 8193 when no maxStringLength is set", () => {
    const { transport, reporter } = aReporter();

    reporter.captureMessage("a".repeat(8192));
    reporter.captureMessage("a".repeat(8193));

    expect(transport.events[0]?.message).toBe("a".repeat(8192));
    expect(transport.events[1]?.message).toBe(`${"a".repeat(8192)}${CUT}`);
  });

  it("keeps the first maxBreadth frames, the throw site first, with no marker for the rest", () => {
    const { transport, reporter } = aLimitedReporter({ maxBreadth: 2 });

    reporter.captureException(anErrorWithFrames(5));

    expect(onlyEvent(transport.events).exception?.frames.map((frame) => frame.function)).toEqual(["fn0", "fn1"]);
  });

  it("keeps every frame when there are no more than maxBreadth", () => {
    const { transport, reporter } = aLimitedReporter({ maxBreadth: 3 });

    reporter.captureException(anErrorWithFrames(3));

    expect(onlyEvent(transport.events).exception?.frames.map((frame) => frame.function)).toEqual(["fn0", "fn1", "fn2"]);
  });

  it("caps the frames of every link of the exception chain", () => {
    const { transport, reporter } = aLimitedReporter({ maxBreadth: 1 });
    const outer = anErrorWithFrames(4, "outer");
    outer.cause = anErrorWithFrames(4, "inner");

    reporter.captureException(outer);

    const exception = onlyEvent(transport.events).exception;
    expect(exception?.frames).toHaveLength(1);
    expect(exception?.cause?.frames).toHaveLength(1);
  });

  it("keeps 100 frames and drops the rest when no maxBreadth is set", () => {
    const { transport, reporter } = aReporter();

    reporter.captureException(anErrorWithFrames(150));

    const frames = onlyEvent(transport.events).exception?.frames ?? [];
    expect(frames).toHaveLength(100);
    expect(frames[99]?.function).toBe("fn99");
  });

  it("caps frames at the same default breadth that attributes are cut to", () => {
    const { transport, reporter } = aReporter();

    reporter.captureException(anErrorWithFrames(150), { attributes: { entries: Array.from({ length: 150 }, (_, index) => index) } });

    const event = onlyEvent(transport.events);
    const kept = (event.attributes.entries as unknown[]).length - 1;
    expect(kept).toBeLessThan(150);
    expect(event.exception?.frames).toHaveLength(kept);
  });

  it("bounds the call's and the scope's attributes by the configured limits", () => {
    const { transport, reporter } = aLimitedReporter({ maxStringLength: 3 });

    Scope.isolated("request", { scoped: "abcdef" }, () => {
      reporter.captureMessage("m");
    });
    reporter.captureException(new Error("e"), { attributes: { called: "abcdef" } });

    expect(transport.events[0]?.attributes.scoped).toBe(`abc${CUT}`);
    expect(transport.events[1]?.attributes.called).toBe(`abc${CUT}`);
  });

  it("bounds the exception chain by the configured limits", () => {
    const { transport, reporter } = aLimitedReporter({ maxLinks: 1, maxStringLength: 4 });
    const error = new Error("outermost", { cause: new Error("middle", { cause: new Error("innermost") }) });

    reporter.captureException(error);

    const exception = onlyEvent(transport.events).exception;
    expect(exception?.message).toBe(`oute${CUT}`);
    expect(exception?.cause?.message).toBe(`midd${CUT}`);
    expect(exception?.cause?.cause?.type).toBe("[Truncated]");
  });
});

describe("processors and beforeSend", () => {
  function tagging(tag: string): (event: ErrorEvent) => ErrorEvent {
    return (event) => ({ ...event, attributes: { ...event.attributes, order: `${event.attributes.order ?? ""}${tag}` } });
  }

  it("runs the builder's processors in the order added, then beforeSend, before the transport", () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) =>
      b.transport(transport).beforeSend(tagging("s")).addProcessor(tagging("a")).addProcessor(tagging("b")),
    );

    expect(reporter.captureMessage("m")).toMatch(EVENT_ID);

    expect(onlyEvent(transport.events).attributes.order).toBe("abs");
  });

  it("runs only the beforeSend hook set last", () => {
    const transport = createTestTransport();
    const first = vi.fn(tagging("first"));
    const reporter = createReporter((b) => b.transport(transport).beforeSend(first).beforeSend(tagging("last")));

    reporter.captureMessage("m");

    expect(first).not.toHaveBeenCalled();
    expect(onlyEvent(transport.events).attributes.order).toBe("last");
  });

  it("drops an event beforeSend returns null for, and still returns its id", () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) => b.transport(transport).beforeSend(() => null));

    expect(reporter.captureException(new Error("boom"))).toMatch(EVENT_ID);
    expect(transport.events).toEqual([]);
  });

  it("hands processors and beforeSend an event already redacted", () => {
    const transport = createTestTransport();
    const seen: unknown[] = [];
    const record = (event: ErrorEvent): ErrorEvent => {
      seen.push(event.attributes.password);
      return event;
    };
    const reporter = createReporter((b) => b.transport(transport).addProcessor(record).beforeSend(record));

    reporter.captureMessage("m");
    Scope.isolated("request", { password: "hunter2" }, () =>
      reporter.captureException(new Error("boom"), { attributes: { password: "hunter2" } }),
    );

    expect(seen).toEqual([undefined, undefined, "[REDACTED]", "[REDACTED]"]);
    expect(transport.events[1]?.attributes.password).toBe("[REDACTED]");
  });

  it("never throws out of a capture when a processor throws, and drops the event", () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) =>
      b.transport(transport).addProcessor(() => {
        throw new Error("processor failed");
      }),
    );

    expect(() => reporter.captureMessage("m")).not.toThrow();
    expect(transport.events).toEqual([]);
  });
});
