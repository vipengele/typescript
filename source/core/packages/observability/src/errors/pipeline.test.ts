import { Scope } from "@vipengele/ts-core-common/scope";
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
