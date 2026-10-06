import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "../event";
import { createTestTransport } from "./test-transport";

function anEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 0,
    level: "error",
    mechanism: { handled: true, source: "capture" },
    attributes: {},
    ...overrides,
  };
}

function aResource(name: string): Resource {
  return Object.freeze({
    "service.name": name,
    "service.version": undefined,
    "deployment.environment.name": undefined,
    "process.runtime.name": undefined,
  });
}

describe("createTestTransport", () => {
  it("records every sent event", () => {
    const transport = createTestTransport();
    const first = anEvent({ message: "first" });
    const second = anEvent({ message: "second" });

    transport.send(first, aResource("a"));
    transport.send(second, aResource("b"));

    expect(transport.events).toEqual([first, second]);
  });

  it("records the Resource each event was sent with, at the event's index", () => {
    const transport = createTestTransport();
    const first = aResource("a");
    const second = aResource("b");

    transport.send(anEvent({ message: "first" }), first);
    transport.send(anEvent({ message: "second" }), second);

    expect(transport.resources).toEqual([first, second]);
    expect(transport.resources[1]).toBe(second);
  });

  it("clears recorded events without closing the transport", async () => {
    const transport = createTestTransport();
    transport.send(anEvent(), aResource("a"));

    transport.clear();

    expect(transport.events).toEqual([]);
    expect(transport.resources).toEqual([]);
    transport.send(anEvent(), aResource("a"));
    expect(transport.events).toHaveLength(1);
    expect(transport.resources).toHaveLength(1);
    await expect(transport.close()).resolves.toBe(true);
  });

  it("resolves flush true", async () => {
    const transport = createTestTransport();
    await expect(transport.flush()).resolves.toBe(true);
  });

  it("resolves close true", async () => {
    const transport = createTestTransport();
    await expect(transport.close()).resolves.toBe(true);
  });

  it("turns send into a no-op after close", async () => {
    const transport = createTestTransport();
    await transport.close();

    transport.send(anEvent(), aResource("a"));

    expect(transport.events).toEqual([]);
    expect(transport.resources).toEqual([]);
  });
});
