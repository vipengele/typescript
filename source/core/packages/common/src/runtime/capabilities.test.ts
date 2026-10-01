import { afterEach, describe, expect, test, vi } from "vitest";
import { type Capability, detectCapability, resetDetectedCapabilities } from "./capabilities";
import type { RuntimeSource } from "./identity";

class FakeAsyncLocalStorage {}
class FakeAsyncContextVariable {}

const nodeVersions = { node: "24.0.0" };

function terminal(env: Record<string, unknown>, isTTY: unknown = true): RuntimeSource {
  return { process: { versions: nodeVersions, env, stdout: { isTTY } } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetDetectedCapabilities();
});

describe("consoleStyling", () => {
  test("a browser renders %c", () => {
    expect(detectCapability("consoleStyling", { window: {}, document: {} })).toBe(true);
  });

  test("a web worker renders %c without a window", () => {
    expect(detectCapability("consoleStyling", { WorkerGlobalScope: () => undefined })).toBe(true);
  });

  test("Deno renders %c", () => {
    expect(detectCapability("consoleStyling", { Deno: {} })).toBe(true);
  });

  test("jsdom inside Node does not, since its console writes to a terminal", () => {
    expect(detectCapability("consoleStyling", { window: {}, document: {}, process: { versions: nodeVersions } })).toBe(false);
  });

  test("Bun, an edge runtime and an unknown runtime do not", () => {
    expect(detectCapability("consoleStyling", { Bun: {} })).toBe(false);
    expect(detectCapability("consoleStyling", { EdgeRuntime: "edge-runtime" })).toBe(false);
    expect(detectCapability("consoleStyling", {})).toBe(false);
  });
});

describe("ansiColour", () => {
  test("a TTY whose TERM is not dumb renders colour", () => {
    expect(detectCapability("ansiColour", terminal({ TERM: "xterm-256color" }))).toBe(true);
    expect(detectCapability("ansiColour", terminal({}))).toBe(true);
  });

  test("a dumb terminal does not", () => {
    expect(detectCapability("ansiColour", terminal({ TERM: "dumb" }))).toBe(false);
  });

  test("output that is not a TTY does not", () => {
    expect(detectCapability("ansiColour", terminal({}, false))).toBe(false);
    expect(detectCapability("ansiColour", { process: { env: {}, stdout: {} } })).toBe(false);
    expect(detectCapability("ansiColour", { process: { env: {} } })).toBe(false);
  });

  test("NO_COLOR forces colour off, even with FORCE_COLOR set", () => {
    expect(detectCapability("ansiColour", terminal({ NO_COLOR: "1" }))).toBe(false);
    expect(detectCapability("ansiColour", terminal({ NO_COLOR: "1", FORCE_COLOR: "1" }))).toBe(false);
  });

  test("an empty NO_COLOR is unset", () => {
    expect(detectCapability("ansiColour", terminal({ NO_COLOR: "" }))).toBe(true);
  });

  test("FORCE_COLOR forces colour on without a TTY", () => {
    expect(detectCapability("ansiColour", terminal({ FORCE_COLOR: "1" }, false))).toBe(true);
    expect(detectCapability("ansiColour", terminal({ FORCE_COLOR: "" }, false))).toBe(true);
  });

  test("FORCE_COLOR of 0 or false forces colour off on a TTY", () => {
    expect(detectCapability("ansiColour", terminal({ FORCE_COLOR: "0" }))).toBe(false);
    expect(detectCapability("ansiColour", terminal({ FORCE_COLOR: "false" }))).toBe(false);
  });

  test("an environment value that is not a string is unset", () => {
    expect(detectCapability("ansiColour", terminal({ NO_COLOR: 1, TERM: { name: "dumb" } }))).toBe(true);
  });

  test("an environment that throws on read, as Deno's does without permission, is unset", () => {
    const env = new Proxy(
      {},
      {
        get() {
          throw new Error("permission denied");
        },
      },
    );

    expect(detectCapability("ansiColour", terminal(env))).toBe(true);
  });

  test("a process without env falls back to the TTY", () => {
    expect(detectCapability("ansiColour", { process: { stdout: { isTTY: true } } })).toBe(true);
  });

  test("a runtime without process does not render colour", () => {
    expect(detectCapability("ansiColour", { window: {}, document: {} })).toBe(false);
  });
});

describe("asyncContext", () => {
  test("AsyncLocalStorage reached through getBuiltinModule offers async context", () => {
    const source = { process: { getBuiltinModule: () => ({ AsyncLocalStorage: FakeAsyncLocalStorage }) } };

    expect(detectCapability("asyncContext", source)).toBe(true);
  });

  test("AsyncContext.Variable offers async context", () => {
    expect(detectCapability("asyncContext", { AsyncContext: { Variable: FakeAsyncContextVariable } })).toBe(true);
  });

  test("a process polyfill without getBuiltinModule offers none", () => {
    expect(detectCapability("asyncContext", { process: { on: () => undefined } })).toBe(false);
  });

  test("a runtime with neither offers none", () => {
    expect(detectCapability("asyncContext", {})).toBe(false);
  });
});

describe("sendBeacon", () => {
  test("navigator.sendBeacon is detected", () => {
    expect(detectCapability("sendBeacon", { navigator: { sendBeacon: () => true } })).toBe(true);
  });

  test("a navigator without sendBeacon, as in a web worker, is not", () => {
    expect(detectCapability("sendBeacon", { navigator: { userAgent: "Mozilla/5.0" } })).toBe(false);
    expect(detectCapability("sendBeacon", { navigator: { sendBeacon: "not a function" } })).toBe(false);
  });

  test("a runtime without navigator is not", () => {
    expect(detectCapability("sendBeacon", {})).toBe(false);
  });
});

describe("processExitHooks", () => {
  test("a real process offers exit hooks", () => {
    expect(detectCapability("processExitHooks", { process: { getBuiltinModule: () => undefined, on: () => undefined } })).toBe(true);
  });

  test("a process polyfill's no-op on, without getBuiltinModule, does not", () => {
    expect(detectCapability("processExitHooks", { process: { on: () => undefined } })).toBe(false);
  });

  test("a process without on does not", () => {
    expect(detectCapability("processExitHooks", { process: { getBuiltinModule: () => undefined } })).toBe(false);
  });

  test("a runtime without process does not", () => {
    expect(detectCapability("processExitHooks", {})).toBe(false);
  });
});

describe(detectCapability.name, () => {
  test("an injected source is read on every call, never memoised", () => {
    const source: { navigator?: { sendBeacon: () => boolean } } = {};

    expect(detectCapability("sendBeacon", source)).toBe(false);

    source.navigator = { sendBeacon: () => true };
    expect(detectCapability("sendBeacon", source)).toBe(true);
  });

  test("without a source, globalThis is read once per capability and memoised until reset", () => {
    const first = detectCapability("sendBeacon");

    vi.stubGlobal("navigator", { sendBeacon: first ? undefined : () => true });
    expect(detectCapability("sendBeacon")).toBe(first);

    resetDetectedCapabilities();
    expect(detectCapability("sendBeacon")).toBe(!first);
  });

  test("each capability is memoised on its own", () => {
    detectCapability("sendBeacon");

    vi.stubGlobal("AsyncContext", { Variable: FakeAsyncContextVariable });
    expect(detectCapability("asyncContext")).toBe(true);
  });

  test("an injected source neither reads nor fills the memo", () => {
    expect(detectCapability("sendBeacon", { navigator: { sendBeacon: () => true } })).toBe(true);

    vi.stubGlobal("navigator", {});
    expect(detectCapability("sendBeacon")).toBe(false);
  });

  test("every capability answers a boolean from globalThis", () => {
    const capabilities: Capability[] = ["consoleStyling", "ansiColour", "asyncContext", "sendBeacon", "processExitHooks"];

    for (const capability of capabilities) {
      expect(typeof detectCapability(capability)).toBe("boolean");
    }
  });
});
