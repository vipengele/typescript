import { describe, expect, test } from "vitest";
import { type BrowserSourcesHost, clearStoredSpec, readBrowserSources } from "./browser-sources";

/** An in-memory `Storage` stand-in holding `entries`. */
function storage(entries: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key: string): unknown => (values.has(key) ? values.get(key) : null),
    removeItem: (key: string): void => {
      values.delete(key);
    },
  };
}

/** A browser host whose URL query is `search` and whose `localStorage` is `localStorage`. */
function browser(search: unknown, localStorage?: unknown): BrowserSourcesHost {
  return { window: {}, document: {}, location: { search }, localStorage };
}

function throwing(): never {
  throw new Error("blocked");
}

describe("readBrowserSources", () => {
  test("reads the stored spec, then the URL's, so the URL comes last and wins", () => {
    const reading = readBrowserSources(undefined, browser("?log=a:debug,b:info", storage({ "vipengele.log": "a:error,c:trace" })));

    expect(reading).toEqual({
      kind: "read",
      storageKey: "vipengele.log",
      specs: [
        { levels: { a: "error", c: "trace" }, issues: [] },
        { levels: { a: "debug", b: "info" }, issues: [] },
      ],
      unreadableStored: undefined,
    });
  });

  test("reads the URL parameter and storage key the options name", () => {
    const host = browser("?log=a:info&level=a:debug", storage({ "vipengele.log": "b:info", "app.log": "b:trace" }));

    const reading = readBrowserSources({ urlParameter: "level", storageKey: "app.log" }, host);

    expect(reading).toEqual({
      kind: "read",
      storageKey: "app.log",
      specs: [
        { levels: { b: "trace" }, issues: [] },
        { levels: { a: "debug" }, issues: [] },
      ],
      unreadableStored: undefined,
    });
  });

  test("reads nothing, and finds no source, when the host has neither", () => {
    expect(readBrowserSources({}, browser("?other=1", storage()))).toEqual({
      kind: "read",
      storageKey: "vipengele.log",
      specs: [],
      unreadableStored: undefined,
    });
  });

  test("a host that is not a browser is unavailable, whatever it holds", () => {
    expect(
      readBrowserSources(undefined, { location: { search: "?log=a:debug" }, localStorage: storage({ "vipengele.log": "a:info" }) }),
    ).toEqual({
      kind: "unavailable",
    });
    expect(readBrowserSources(undefined, { ...browser("?log=a:debug"), process: { versions: { node: "24.0.0" } } })).toEqual({
      kind: "unavailable",
    });
  });

  test("malformed options are invalid, whatever the host", () => {
    const host = browser("?log=a:debug");

    expect(readBrowserSources(null, host)).toEqual({
      kind: "invalid",
      message: "Invalid logger browser sources options of type null: expected an object.",
    });
    expect(readBrowserSources("log", {})).toEqual({
      kind: "invalid",
      message: "Invalid logger browser sources options of type string: expected an object.",
    });
    expect(readBrowserSources({ urlParameter: "" }, host)).toEqual({
      kind: "invalid",
      message: 'Invalid logger browser sources option urlParameter "": expected a non-empty string.',
    });
    expect(readBrowserSources({ urlParameter: 1 }, host)).toEqual({
      kind: "invalid",
      message: "Invalid logger browser sources option urlParameter of type number: expected a non-empty string.",
    });
    expect(readBrowserSources({ storageKey: null }, host)).toEqual({
      kind: "invalid",
      message: "Invalid logger browser sources option storageKey of type null: expected a non-empty string.",
    });
  });

  test("an unreadable URL is no source", () => {
    const stored = storage({ "vipengele.log": "a:info" });
    const expected = {
      kind: "read",
      storageKey: "vipengele.log",
      specs: [{ levels: { a: "info" }, issues: [] }],
      unreadableStored: undefined,
    };

    expect(readBrowserSources(undefined, { window: {}, document: {}, localStorage: stored })).toEqual(expected);
    expect(readBrowserSources(undefined, browser(42, stored))).toEqual(expected);
    const location = {
      get search(): string {
        return throwing();
      },
    };
    expect(readBrowserSources(undefined, { window: {}, document: {}, location, localStorage: stored })).toEqual(expected);
  });

  test("blocked, missing or throwing storage is no source", () => {
    const expected = {
      kind: "read",
      storageKey: "vipengele.log",
      specs: [{ levels: { a: "info" }, issues: [] }],
      unreadableStored: undefined,
    };
    const blocked = {
      window: {},
      document: {},
      location: { search: "?log=a:info" },
      get localStorage(): unknown {
        return throwing();
      },
    };

    expect(readBrowserSources(undefined, blocked)).toEqual(expected);
    expect(readBrowserSources(undefined, browser("?log=a:info"))).toEqual(expected);
    expect(readBrowserSources(undefined, browser("?log=a:info", { getItem: throwing, removeItem: throwing }))).toEqual(expected);
  });

  test("an empty or non-string stored value is absent: no source, no issue, nothing to clear", () => {
    for (const value of ["", 7]) {
      expect(readBrowserSources(undefined, browser("", storage({ "vipengele.log": value })))).toEqual({
        kind: "read",
        storageKey: "vipengele.log",
        specs: [],
        unreadableStored: undefined,
      });
    }
  });

  test("names the storage key in each issue of the stored spec and the parameter in each of the URL's", () => {
    const reading = readBrowserSources({ storageKey: "app.log" }, browser("?log=b:loud,c:info", storage({ "app.log": "a:info,bad" })));

    expect(reading).toEqual({
      kind: "read",
      storageKey: "app.log",
      specs: [
        {
          levels: { a: "info" },
          issues: ['localStorage "app.log": Level spec entry "bad" is skipped: expected "category:level" with exactly one ":".'],
        },
        { levels: { c: "info" }, issues: ['URL parameter "log": Level spec entry "b:loud" is skipped: invalid level "loud".'] },
      ],
      unreadableStored: undefined,
    });
  });

  test("a stored spec that holds no level is unreadable, and says it is removed", () => {
    const reading = readBrowserSources(undefined, browser("", storage({ "vipengele.log": "[object Object]" })));

    expect(reading).toEqual({
      kind: "read",
      storageKey: "vipengele.log",
      specs: [
        {
          levels: {},
          issues: [
            'localStorage "vipengele.log": Level spec entry "[object Object]" is skipped: expected "category:level" with exactly one ":".',
            'localStorage "vipengele.log": the stored spec holds no level and is removed from storage.',
          ],
        },
      ],
      unreadableStored: "[object Object]",
    });
  });

  test("a URL that holds no level never makes the stored spec unreadable", () => {
    const reading = readBrowserSources(undefined, browser("?log=nonsense", storage({ "vipengele.log": "a:info" })));

    expect(reading.kind === "read" && reading.unreadableStored).toBeUndefined();
  });
});

describe("clearStoredSpec", () => {
  test("removes the value stored under the key while it is still the value read", () => {
    const stored = storage({ "vipengele.log": "bad" });

    clearStoredSpec("vipengele.log", "bad", { localStorage: stored });

    expect(stored.values.has("vipengele.log")).toBe(false);
  });

  test("keeps a value written since it was read", () => {
    const stored = storage({ "vipengele.log": "a:debug" });

    clearStoredSpec("vipengele.log", "bad", { localStorage: stored });

    expect(stored.values.get("vipengele.log")).toBe("a:debug");
  });

  test("never throws when storage is missing, blocked or throws", () => {
    const blocked = {
      get localStorage(): unknown {
        return throwing();
      },
    };

    expect(() => clearStoredSpec("vipengele.log", "bad", {})).not.toThrow();
    expect(() => clearStoredSpec("vipengele.log", "bad", blocked)).not.toThrow();
    expect(() => clearStoredSpec("vipengele.log", "bad", { localStorage: { getItem: () => "bad", removeItem: throwing } })).not.toThrow();
  });
});
