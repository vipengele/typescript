import type { Threshold } from "@vipengele/ts-core-common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readBrowserSources } from "./browser-sources";
import { createLoggingBuilder } from "./builder";
import { createLoggerProvider } from "./provider";

// Browser-only: the page's real URL and `localStorage`, read through `globalThis`, end to end
// through the builder and a provider's commit. The browser-sources suite covers the reader against
// injected hosts in both runtimes.

const KEY = "vipengele.log";

const originalUrl = globalThis.location.href;

/** Puts `search` in the page's URL query without navigating. */
function setSearch(search: string): void {
  const url = new URL(originalUrl);
  url.search = search;
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

beforeEach(() => {
  globalThis.localStorage.removeItem(KEY);
  globalThis.localStorage.removeItem("app.log");
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.history.replaceState(globalThis.history.state, "", originalUrl);
  globalThis.localStorage.removeItem(KEY);
  globalThis.localStorage.removeItem("app.log");
});

describe("addBrowserSources in a browser", () => {
  test("readBrowserSources reads from globalThis by default", () => {
    setSearch("?log=a:debug");

    expect(readBrowserSources(undefined)).toMatchObject({ kind: "read", specs: [{ levels: { a: "debug" } }] });
  });

  test("the URL beats storage for the same category; storage shows through elsewhere", () => {
    globalThis.localStorage.setItem(KEY, "a:error,b:info");
    setSearch("?log=a:debug");

    const build = createLoggingBuilder().addBrowserSources().build();

    expect({ ...build.builder }).toEqual({ a: "debug", b: "info" });
    expect(build.browserSources).toEqual({ storageKey: KEY });
    expect(Object.isFrozen(build.browserSources)).toBe(true);
  });

  test("keeps its place among the builder's sources", () => {
    setSearch("?log=a:debug,b:debug");

    const build = createLoggingBuilder().addLevels({ a: "info" }).addBrowserSources().addLevels({ b: "error" }).build();

    expect({ ...build.builder }).toEqual({ a: "debug", b: "error" });
  });

  test("reads the parameter and key the options name, and reports the last call's key", () => {
    globalThis.localStorage.setItem("app.log", "b:trace");
    setSearch("?level=a:debug");

    const build = createLoggingBuilder().addBrowserSources().addBrowserSources({ urlParameter: "level", storageKey: "app.log" }).build();

    expect({ ...build.builder }).toEqual({ a: "debug", b: "trace" });
    expect(build.browserSources).toEqual({ storageKey: "app.log" });
  });

  test("blocked storage means no stored source; the URL is still read", () => {
    globalThis.localStorage.setItem(KEY, "b:info");
    setSearch("?log=a:debug");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const build = createLoggingBuilder().addBrowserSources().build();

    expect({ ...build.builder }).toEqual({ a: "debug" });
    expect(build.issues).toEqual([]);
  });

  test("names the URL parameter or the storage key in each issue", () => {
    globalThis.localStorage.setItem(KEY, "a:info,a:loud");
    setSearch("?log=b:loud");

    const build = createLoggingBuilder().addBrowserSources().build();

    expect(build.issues).toEqual([
      'localStorage "vipengele.log": Level spec entry "a:loud" is skipped: invalid level "loud".',
      'URL parameter "log": Level spec entry "b:loud" is skipped: invalid level "loud".',
    ]);
  });

  test("build never touches storage, however often it is called", () => {
    globalThis.localStorage.setItem(KEY, "[object Object]");
    const builder = createLoggingBuilder().addBrowserSources();

    const first = builder.build();
    const second = builder.build();

    expect(second).toEqual(first);
    expect(globalThis.localStorage.getItem(KEY)).toBe("[object Object]");
  });
});

describe("clearing an unreadable stored spec", () => {
  test("a successful configure clears it, and reports why", () => {
    globalThis.localStorage.setItem(KEY, "[object Object]");
    const onIssues = vi.fn();
    const provider = createLoggerProvider(undefined, { onIssues });

    provider.configure((b) => b.addBrowserSources());

    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    expect(onIssues).toHaveBeenCalledWith([
      'localStorage "vipengele.log": Level spec entry "[object Object]" is skipped: expected "category:level" with exactly one ":".',
      'localStorage "vipengele.log": the stored spec holds no level and is removed from storage.',
    ]);
  });

  test("is cleared only once the configuration is in force and published", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");
    const seen: (string | null)[] = [];
    const provider = createLoggerProvider(undefined, {
      publish: () => {
        seen.push(globalThis.localStorage.getItem(KEY));
      },
    });

    provider.configure((b) => b.addBrowserSources());

    expect(seen).toEqual(["nonsense"]);
    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
  });

  test("a rejected configure clears nothing", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");
    const provider = createLoggerProvider();

    expect(() => provider.configure((b) => b.addBrowserSources().addLevels({ a: "loud" as Threshold }))).toThrow();

    expect(globalThis.localStorage.getItem(KEY)).toBe("nonsense");
  });

  test("a configure whose publish throws clears nothing", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");
    const provider = createLoggerProvider(undefined, {
      publish: () => {
        throw new Error("publish failed");
      },
    });

    expect(() => provider.configure((b) => b.addBrowserSources())).toThrow("publish failed");

    expect(globalThis.localStorage.getItem(KEY)).toBe("nonsense");
  });

  test("a starting configuration clears it once in force, before its issues are reported", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");
    const seen: (string | null)[] = [];

    createLoggerProvider((b) => b.addBrowserSources(), {
      onIssues: () => {
        seen.push(globalThis.localStorage.getItem(KEY));
      },
    });

    expect(seen).toEqual([null]);
  });

  test("a rejected starting configuration clears nothing", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");

    expect(() => createLoggerProvider((b) => b.addBrowserSources().addLevels({ a: "loud" as Threshold }))).toThrow();

    expect(globalThis.localStorage.getItem(KEY)).toBe("nonsense");
  });

  test("a bad URL never clears a good stored spec", () => {
    globalThis.localStorage.setItem(KEY, "a:debug");
    setSearch("?log=[object Object]");
    const onIssues = vi.fn();

    const settings = createLoggerProvider(undefined, { onIssues }).configure((b) => b.addBrowserSources());

    expect(globalThis.localStorage.getItem(KEY)).toBe("a:debug");
    expect({ ...settings.layers.builder }).toEqual({ a: "debug" });
    expect(onIssues).toHaveBeenCalledWith([
      'URL parameter "log": Level spec entry "[object Object]" is skipped: expected "category:level" with exactly one ":".',
    ]);
  });

  test("a bad stored spec is cleared even when the URL holds a good one", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");
    setSearch("?log=a:debug");

    const settings = createLoggerProvider().configure((b) => b.addBrowserSources());

    expect(globalThis.localStorage.getItem(KEY)).toBeNull();
    expect({ ...settings.layers.builder }).toEqual({ a: "debug" });
  });

  test("an empty stored string is absent: no warning, no clear", () => {
    globalThis.localStorage.setItem(KEY, "");
    const onIssues = vi.fn();

    createLoggerProvider(undefined, { onIssues }).configure((b) => b.addBrowserSources());

    expect(globalThis.localStorage.getItem(KEY)).toBe("");
    expect(onIssues).not.toHaveBeenCalled();
  });

  test("a spec stored since the build was made is kept", () => {
    globalThis.localStorage.setItem(KEY, "nonsense");

    createLoggerProvider().configure((b) => {
      b.addBrowserSources();
      globalThis.localStorage.setItem(KEY, "a:debug");
    });

    expect(globalThis.localStorage.getItem(KEY)).toBe("a:debug");
  });
});

describe("browserSources in the settings", () => {
  test("is carried by configure and override, and dropped by reset", () => {
    const provider = createLoggerProvider();

    expect(provider.configure((b) => b.addBrowserSources({ storageKey: "app.log" })).browserSources).toEqual({ storageKey: "app.log" });
    expect(provider.override("a", "debug").browserSources).toEqual({ storageKey: "app.log" });
    expect(provider.reset().browserSources).toBeNull();
  });
});
