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

describe("createTestTransport", () => {
  it("records every sent event", () => {
    const transport = createTestTransport();
    const first = anEvent({ message: "first" });
    const second = anEvent({ message: "second" });

    transport.send(first);
    transport.send(second);

    expect(transport.events).toEqual([first, second]);
  });

  it("clears recorded events without closing the transport", async () => {
    const transport = createTestTransport();
    transport.send(anEvent());

    transport.clear();

    expect(transport.events).toEqual([]);
    transport.send(anEvent());
    expect(transport.events).toHaveLength(1);
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

    transport.send(anEvent());

    expect(transport.events).toEqual([]);
  });
});
