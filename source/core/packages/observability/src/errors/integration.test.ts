import { describe, expect, it, vi } from "vitest";
import { type Integration, type IntegrationHost, setupIntegrations } from "./integration";

function aHost(): IntegrationHost {
  return { capture: vi.fn(() => "id"), flush: vi.fn(async () => true) };
}

describe("setupIntegrations", () => {
  it("sets up every integration in order, against the host it is given", () => {
    const host = aHost();
    const seen: string[] = [];
    const integrations: Integration[] = ["a", "b"].map((name) => ({
      name,
      setup: (given) => {
        expect(given).toBe(host);
        seen.push(name);
      },
    }));

    setupIntegrations(integrations, host);

    expect(seen).toEqual(["a", "b"]);
  });

  it("tears down last installed first, once, skipping an integration with nothing to tear down", () => {
    const seen: string[] = [];
    const integrations: Integration[] = [
      { name: "a", setup: () => () => seen.push("a") },
      { name: "none", setup: () => undefined },
      { name: "b", setup: () => () => seen.push("b") },
    ];

    const teardown = setupIntegrations(integrations, aHost());
    teardown();
    teardown();

    expect(seen).toEqual(["b", "a"]);
  });

  it("skips an integration whose setup throws, and still sets up and tears down the others", () => {
    const teardown = vi.fn();
    const later = vi.fn(() => teardown);
    const integrations: Integration[] = [
      {
        name: "broken",
        setup: () => {
          throw new Error("setup failed");
        },
      },
      { name: "later", setup: later },
    ];

    const teardownAll = setupIntegrations(integrations, aHost());
    teardownAll();

    expect(later).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("still tears down the others when a teardown throws", () => {
    const first = vi.fn();
    const integrations: Integration[] = [
      { name: "first", setup: () => first },
      {
        name: "broken",
        setup: () => () => {
          throw new Error("teardown failed");
        },
      },
    ];

    const teardown = setupIntegrations(integrations, aHost());

    expect(teardown).not.toThrow();
    expect(first).toHaveBeenCalledOnce();
  });
});
