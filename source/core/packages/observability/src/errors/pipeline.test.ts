import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "./event";
import { createReporter } from "./reporter";
import { createTestTransport } from "./transports/test-transport";

const RESOURCE_KEYS = ["service.name", "service.version", "deployment.environment.name", "process.runtime.name"];

function onlyEvent(events: readonly ErrorEvent[]): ErrorEvent {
  expect(events).toHaveLength(1);
  return events[0] as ErrorEvent;
}

function aReporter() {
  const transport = createTestTransport();
  return { transport, reporter: createReporter((b) => b.transport(transport)) };
}

afterEach(() => {
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
  it("hands send the Resource Scope.resource() returns at delivery, alongside the event", () => {
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
