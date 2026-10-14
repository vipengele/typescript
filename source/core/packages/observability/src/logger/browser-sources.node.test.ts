import { afterEach, describe, expect, test, vi } from "vitest";
import { readBrowserSources } from "./browser-sources";
import { createLoggingBuilder } from "./builder";
import { createLoggerProvider } from "./provider";

// Node-only: outside a browser the browser sources read nothing, even with a `location` and a
// `localStorage` on `globalThis`. The browser-sources suite covers the reader against injected
// hosts in both runtimes.

function storage(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser sources under Node", () => {
  test("readBrowserSources reads from globalThis by default and finds no browser", () => {
    expect(readBrowserSources(undefined)).toEqual({ kind: "unavailable" });
  });

  test("addBrowserSources is a no-op that touches neither location nor storage", () => {
    const stored = storage({ "vipengele.log": "[object Object]" });
    vi.stubGlobal("location", { search: "?log=a:debug" });
    vi.stubGlobal("localStorage", stored);

    const build = createLoggingBuilder().addBrowserSources().build();
    createLoggerProvider((b) => b.addBrowserSources()).configure((b) => b.addBrowserSources());

    expect(Object.keys(build.builder)).toEqual([]);
    expect(build.browserSources).toBeNull();
    expect(build.issues).toEqual([]);
    expect(stored.getItem).not.toHaveBeenCalled();
    expect(stored.removeItem).not.toHaveBeenCalled();
  });

  test("malformed options still make build throw", () => {
    expect(() => createLoggingBuilder().addBrowserSources({ storageKey: "" }).build()).toThrow(
      'Invalid logger browser sources option storageKey "": expected a non-empty string.',
    );
  });
});
