import { describe, expect, it, vi } from "vitest";
import type { Level } from "@vipengele/ts-core-common";
import type { ErrorEvent } from "../event";
import { createConsoleTransport } from "./console-transport";
import type { ConsoleLike } from "./console-transport";

function anEvent(level: Level): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 0,
    level,
    mechanism: { handled: true, source: "capture" },
    attributes: {},
  };
}

function aConsole(): ConsoleLike {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe("createConsoleTransport", () => {
  it.each<[Level, keyof ConsoleLike]>([
    ["fatal", "error"],
    ["error", "error"],
    ["warn", "warn"],
    ["info", "info"],
    ["debug", "debug"],
    ["trace", "debug"],
  ])("writes a %s event to console.%s", (level, method) => {
    const target = aConsole();
    const transport = createConsoleTransport({ console: target });
    const event = anEvent(level);

    transport.send(event);

    expect(target[method]).toHaveBeenCalledWith(event);
    for (const other of ["error", "warn", "info", "debug"] as const) {
      if (other !== method) {
        expect(target[other]).not.toHaveBeenCalled();
      }
    }
  });

  it("defaults to globalThis.console", () => {
    const spy = vi.spyOn(globalThis.console, "info").mockImplementation(() => undefined);
    const transport = createConsoleTransport();

    transport.send(anEvent("info"));

    expect(spy).toHaveBeenCalledWith(anEvent("info"));
    spy.mockRestore();
  });

  it("resolves flush true", async () => {
    const transport = createConsoleTransport({ console: aConsole() });
    await expect(transport.flush()).resolves.toBe(true);
  });

  it("resolves close true", async () => {
    const transport = createConsoleTransport({ console: aConsole() });
    await expect(transport.close()).resolves.toBe(true);
  });

  it("turns send into a no-op after close", async () => {
    const target = aConsole();
    const transport = createConsoleTransport({ console: target });
    await transport.close();

    transport.send(anEvent("error"));

    expect(target.error).not.toHaveBeenCalled();
  });
});
