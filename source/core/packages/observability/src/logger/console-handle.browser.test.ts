import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConsoleHandle } from "./console-handle";
import { createLoggerProvider } from "./provider";
import type { LogRecord } from "./record";

// Browser-only: the page's real `localStorage` and URL, end to end through a provider whose build
// reads the browser sources. The console-handle suite covers persistence against injected storage
// in both runtimes.

const KEY = "vipengele.log";
const NAME = "__vpgBrowserConsoleHandle";

const originalUrl = globalThis.location.href;

beforeEach(() => {
  globalThis.localStorage.removeItem(KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.history.replaceState(globalThis.history.state, "", originalUrl);
  globalThis.localStorage.removeItem(KEY);
  Reflect.deleteProperty(globalThis, NAME);
});

function handle(): ConsoleHandle {
  return (globalThis as unknown as Record<string, ConsoleHandle>)[NAME] as ConsoleHandle;
}

function provider(browserSources: boolean) {
  const records: LogRecord[] = [];
  const created = createLoggerProvider((b) => {
    b.addSink({ write: (record) => records.push(record) });
    if (browserSources) {
      b.addBrowserSources();
    }
  });
  created.installConsole(NAME);
  return { provider: created, records };
}

describe("a console handle in a browser", () => {
  test("stores a change, which the next load reads back as a builder source", () => {
    const { records } = provider(true);

    handle()("app:debug");

    expect(globalThis.localStorage.getItem(KEY)).toBe("app:debug");
    expect(records[0]?.message).toContain('Saved to localStorage "vipengele.log"');
    const next = createLoggerProvider().configure((b) => b.addBrowserSources());
    expect({ ...next.layers.builder }).toEqual({ app: "debug" });
    expect({ ...next.layers.overrides }).toEqual({});
  });

  test("never writes the URL", () => {
    const url = new URL(originalUrl);
    url.search = "?log=a:info";
    globalThis.history.replaceState(globalThis.history.state, "", url);
    provider(true);

    handle()("b:debug");

    expect(globalThis.location.search).toBe("?log=a:info");
  });

  test("reset leaves the stored spec in place; null removes it", () => {
    const { provider: created } = provider(true);
    handle()("app:debug");

    created.reset();
    expect(globalThis.localStorage.getItem(KEY)).toBe("app:debug");

    created.configure((b) => b.addBrowserSources());
    handle()(null);
    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
  });

  test("blocked storage applies the change to this page only", () => {
    const { provider: created, records } = provider(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    handle()("app:debug");

    expect(created.logger("app").enabled("debug")).toBe(true);
    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    expect(records[0]?.message).toContain("Not saved: storage is blocked, so this applies to this page only.");
  });

  test("stores nothing when the build has no browser sources", () => {
    const { records } = provider(false);

    handle()("app:debug");

    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    expect(records[0]?.message).toContain("Not saved: the configuration in force reads no browser sources");
  });
});
