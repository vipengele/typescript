import { systemClock, type Threshold } from "@vipengele/ts-core-common";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { type ConsoleHandle, type ConsoleHandleHost, installConsoleHandle, isConsoleHandle } from "./console-handle";
import { createLoggerProvider, type LoggerProviderOptions } from "./provider";
import type { LogRecord, Sink } from "./record";
import { createSettings, EMPTY_LAYER, type LevelLayer, type LoggingSettings } from "./settings";

const isConfigError = expect.toSatisfy(isLoggingConfigError);

const registry = globalThis as unknown as Record<string, unknown>;

/** Every name a test installs at, removed after each test. */
const installed = new Set<string>();

let names = 0;

/** A global name no other test uses. */
function freshName(): string {
  names += 1;
  const name = `__vpgConsoleHandleTest${names}`;
  installed.add(name);
  return name;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of installed) {
    Reflect.deleteProperty(registry, name);
  }
  installed.clear();
});

function handleAt(name: string): ConsoleHandle {
  return registry[name] as ConsoleHandle;
}

/** A provider writing to a collecting sink, with a console handle installed at a fresh name. */
function setup(configure?: Parameters<typeof createLoggerProvider>[0], options: LoggerProviderOptions = {}) {
  const records: LogRecord[] = [];
  const sink: Sink = { write: (record) => records.push(record) };
  const provider = createLoggerProvider((b) => {
    b.addSink(sink);
    configure?.(b);
  }, options);
  const name = freshName();
  const uninstall = provider.installConsole(name);
  return { provider, records, name, handle: handleAt(name), uninstall, messages: () => records.map((record) => record.message) };
}

describe("installConsole", () => {
  test("installs a frozen handle, tagged as one, under the name", () => {
    const { handle } = setup();

    expect(handle).toBeTypeOf("function");
    expect(isConsoleHandle(handle)).toBe(true);
    expect(Object.isFrozen(handle)).toBe(true);
  });

  test("a function that is not a handle is not recognised as one", () => {
    expect(isConsoleHandle(() => {})).toBe(false);
    expect(isConsoleHandle({})).toBe(false);
  });

  test("throws on a name that is not a non-empty string", () => {
    const provider = createLoggerProvider();

    expect(() => provider.installConsole("")).toThrow(isConfigError);
    expect(() => provider.installConsole("")).toThrow('Invalid console handle name "": expected a non-empty string.');
    expect(() => provider.installConsole(3 as unknown as string)).toThrow("Invalid console handle name of type number");
    expect(() => provider.installConsole(null as unknown as string)).toThrow("Invalid console handle name of type null");
  });

  test("throws when the name holds something it did not install, leaving it in place", () => {
    const name = freshName();
    registry[name] = 1;
    const provider = createLoggerProvider();

    expect(() => provider.installConsole(name)).toThrow(isConfigError);
    expect(() => provider.installConsole(name)).toThrow(
      `Cannot install a console handle at globalThis.${name}: it already holds something else.`,
    );
    expect(registry[name]).toBe(1);

    registry[name] = () => {};
    expect(() => provider.installConsole(name)).toThrow(isConfigError);
  });

  test("throws when the name cannot be read", () => {
    const name = freshName();
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error("no");
      },
    });

    expect(() => createLoggerProvider().installConsole(name)).toThrow("it already holds something else");
  });

  test("throws when the name cannot be written", () => {
    const name = freshName();
    Object.defineProperty(globalThis, name, { configurable: true, writable: false, value: undefined });

    expect(() => createLoggerProvider().installConsole(name)).toThrow(isConfigError);
    expect(() => createLoggerProvider().installConsole(name)).toThrow(
      `Cannot install a console handle at globalThis.${name}: the property cannot be written.`,
    );
  });

  test("uninstall removes the handle", () => {
    const { name, uninstall } = setup();

    uninstall();

    expect(Object.hasOwn(globalThis, name)).toBe(false);
  });

  test("re-installing the same name replaces the handle, and the first uninstall leaves the second in place", () => {
    const first = setup();
    const second = createLoggerProvider((b) => b.addSink({ write: () => {} }));

    const uninstall = second.installConsole(first.name);
    const replacement = handleAt(first.name);
    first.uninstall();

    expect(replacement).not.toBe(first.handle);
    expect(registry[first.name]).toBe(replacement);

    uninstall();
    expect(Object.hasOwn(globalThis, first.name)).toBe(false);
  });

  test("uninstall leaves undefined behind when the property cannot be deleted", () => {
    const name = `__vpgConsoleHandleTestPermanent${Date.now()}`;
    Object.defineProperty(globalThis, name, { configurable: false, writable: true, value: undefined });
    const uninstall = createLoggerProvider().installConsole(name);
    expect(isConsoleHandle(registry[name])).toBe(true);

    uninstall();

    expect(registry[name]).toBeUndefined();
  });
});

describe("the handle", () => {
  test("with no argument reports the effective levels and how to change them", () => {
    const { handle, name, records } = setup((b) => b.addLevels({ app: "debug" }));

    handle();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "info", category: "vipengele.logger.console" });
    expect(records[0]?.message).toBe(
      `Logger levels: *:warn, app:debug. Call ${name}("category:level"), ${name}({ levels }) or ${name}(null) to change them.`,
    );
  });

  test("its confirmation is written whatever level governs its own category", () => {
    const { handle, records } = setup((b) => b.addLevels({ "*": "off", vipengele: "off" }));

    handle();
    handle("vipengele.logger.console:off");

    expect(records).toHaveLength(2);
  });

  test("its confirmation goes through the processors in force", () => {
    const { handle, records } = setup((b) => b.addProcessor((record) => (record.category === "vipengele.logger.console" ? null : record)));

    handle();

    expect(records).toEqual([]);
  });

  test("a spec string is merged into the overrides and changes what a Logger reports", () => {
    const publish = vi.fn();
    const { provider, handle, messages } = setup(undefined, { publish });
    const logger = provider.logger("app.db");
    const before = provider.override("net", "error");

    handle("app:debug, *:info");

    expect(logger.enabled("debug")).toBe(true);
    const published = publish.mock.lastCall?.[0] as LoggingSettings;
    expect({ ...published.layers.overrides }).toEqual({ net: "error", app: "debug", "*": "info" });
    expect({ ...before.layers.overrides }).toEqual({ net: "error" });
    expect(messages()).toEqual([
      "Logger levels changed: *:info, net:error, app:debug. " +
        "Not saved: the configuration in force reads no browser sources, so this applies until the page or process ends.",
    ]);
  });

  test("a { levels } object is applied as the spec it converts to", () => {
    const publish = vi.fn();
    const { provider, handle } = setup(undefined, { publish });

    handle({ levels: { app: "trace", "app.db": "off" } });

    expect(provider.logger("app").enabled("trace")).toBe(true);
    expect(provider.logger("app.db").enabled("fatal")).toBe(false);
    const published = publish.mock.lastCall?.[0] as LoggingSettings;
    expect({ ...published.layers.overrides }).toEqual({ app: "trace", "app.db": "off" });
  });

  test("null removes every override in force", () => {
    const { provider, handle, messages } = setup();
    provider.override("a", "debug");
    handle("b:trace");

    handle(null);

    expect(provider.logger("a").enabled("debug")).toBe(false);
    expect(provider.logger("b").enabled("trace")).toBe(false);
    expect(messages().at(-1)).toBe("Logger overrides removed. Levels: *:warn.");
  });

  test.each([
    ["a skipped entry", "a:loud", 'Nothing changed: Level spec entry "a:loud" is skipped: invalid level "loud".'],
    ["a stringified object", "[object Object]", 'Nothing changed: Level spec entry "[object Object]" is skipped'],
    ["a repeated category", "a:debug,a:info", "repeats category"],
    ["a spec with no level", " , ", 'Nothing changed: level spec " , " sets no level. Pass null to remove every override.'],
    ["an empty { levels }", { levels: {} }, 'level spec "" sets no level'],
    [
      "a { levels } entry that is not a string",
      { levels: { a: 3 } },
      'Invalid logger level of type number for category "a" in { levels }.',
    ],
    ["a { levels } entry that is null", { levels: { a: null } }, "Invalid logger level of type null"],
    ["a { levels } key that is not a category", { levels: { "a:b": "debug" } }, "is skipped"],
    ["a number", 3, "Invalid console handle argument of type number: expected a level spec string, { levels }, null or nothing."],
    ["an array", ["a:debug"], "Invalid console handle argument of type array"],
    ["an object without levels", { a: "debug" }, "Invalid console handle argument of type object"],
    ["levels that are an array", { levels: ["debug"] }, "Invalid console handle argument of type object"],
    ["levels that are null", { levels: null }, "Invalid console handle argument of type object"],
  ])("throws a LoggingConfigError on %s, changing and confirming nothing", (_, input, message) => {
    const publish = vi.fn();
    const { provider, handle, records } = setup(undefined, { publish });
    provider.override("keep", "debug");
    publish.mockClear();

    expect(() => handle(input as never)).toThrow(isConfigError);
    expect(() => handle(input as never)).toThrow(message);
    expect(publish).not.toHaveBeenCalled();
    expect(records).toEqual([]);
    expect(provider.logger("keep").enabled("debug")).toBe(true);
  });

  test("names every override VPG_LOG takes precedence over", () => {
    const { handle, messages } = setup(undefined, { environment: () => "app:error,net:info,other:debug" });

    handle("app:debug,net:info,web:trace");

    expect(messages()).toEqual([
      "Logger levels changed: *:warn, app:error, net:info, web:trace, other:debug. " +
        "VPG_LOG takes precedence for app (error, not debug), net (info, not info). " +
        "Not saved: the configuration in force reads no browser sources, so this applies until the page or process ends.",
    ]);
  });

  test("a report reads VPG_LOG first and names what it shadows", () => {
    const environment = vi.fn(() => "app:error");
    const records: LogRecord[] = [];
    const provider = createLoggerProvider((b) => b.addSink({ write: (record) => records.push(record) }), { environment });
    provider.override("app", "trace");
    const name = freshName();
    provider.installConsole(name);

    handleAt(name)();

    expect(environment).toHaveBeenCalledOnce();
    expect(records.at(-1)?.message).toContain("Logger levels: *:warn, app:error. VPG_LOG takes precedence for app (error, not trace).");
  });

  test("a report before anything else brings the environment layer in", () => {
    const records: LogRecord[] = [];
    const provider = createLoggerProvider((b) => b.addSink({ write: (record) => records.push(record) }), {
      environment: () => "app:error",
    });
    const name = freshName();
    provider.installConsole(name);

    handleAt(name)();

    expect(records[0]?.message).toContain("Logger levels: *:warn, app:error.");
  });

  test("says what a category no key governs falls back to", () => {
    const { handle, messages } = setup((b) => b.clearDefaults());

    handle();
    handle("a:debug");

    expect(messages()[0]).toMatch(/^Logger levels: every category at warn\. /);
    expect(messages()[1]).toMatch(/^Logger levels changed: a:debug, every other category at warn\. /);
  });

  test("with no sink, the confirmation goes as one line to the warn option", () => {
    const warn = vi.fn();
    const provider = createLoggerProvider(undefined, { warn });
    const name = freshName();
    provider.installConsole(name);

    handleAt(name)("a:debug");

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Logger levels changed: \*:warn, a:debug\. /));
  });

  test("with no sink and no warn option, the confirmation goes to console.warn", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createLoggerProvider();
    const name = freshName();
    provider.installConsole(name);

    handleAt(name)();

    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn.mock.lastCall?.[0]).toMatch(/^Logger levels: \*:warn\. /);
  });
});

describe("persistence", () => {
  /** A host over `settings` whose overrides `setOverrides` replaces, and whose confirmations are collected. */
  function fakeHost(storageKey: string | null): { host: ConsoleHandleHost; confirmed: string[]; overrides: () => LevelLayer } {
    let settings = createSettings(
      { defaults: { "*": "warn" }, builder: EMPTY_LAYER, overrides: EMPTY_LAYER, environment: EMPTY_LAYER },
      { sinks: [], processors: [], clock: systemClock, redaction: null, browserSources: storageKey === null ? null : { storageKey } },
    );
    const confirmed: string[] = [];
    return {
      confirmed,
      overrides: () => settings.layers.overrides,
      host: {
        settings: () => settings,
        setOverrides(overrides) {
          settings = createSettings({ ...settings.layers, overrides }, settings);
          return settings;
        },
        confirm: (message) => confirmed.push(message),
      },
    };
  }

  /** An in-memory `localStorage`, whose methods throw when `blocked`. */
  function fakeStorage(initial: Record<string, string> = {}, blocked = false) {
    const items = new Map(Object.entries(initial));
    const guard = () => {
      if (blocked) {
        throw new Error("SecurityError");
      }
    };
    return {
      items,
      localStorage: {
        getItem: (key: string) => {
          guard();
          return items.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          guard();
          items.set(key, value);
        },
        removeItem: (key: string) => {
          guard();
          items.delete(key);
        },
      },
    };
  }

  function install(storageKey: string | null, storage: object) {
    const fake = fakeHost(storageKey);
    const name = freshName();
    installConsoleHandle(name, fake.host, storage);
    return { ...fake, handle: handleAt(name) };
  }

  test("a change is merged into the stored spec while browser sources are enabled", () => {
    const storage = fakeStorage({ "app.log": "a:info,b:error" });
    const { handle, confirmed } = install("app.log", storage);

    handle("b:debug,c:trace");

    expect(storage.items.get("app.log")).toBe("a:info,b:debug,c:trace");
    expect(confirmed).toEqual([
      "Logger levels changed: *:warn, b:debug, c:trace. " +
        'Saved to localStorage "app.log": after a reload it returns as a builder source, below overrides and below any source added ' +
        "after addBrowserSources, and Logging.reset() does not clear it.",
    ]);
  });

  test("an unreadable stored spec contributes nothing to what is saved", () => {
    const storage = fakeStorage({ "app.log": "[object Object]" });
    const { handle } = install("app.log", storage);

    handle({ levels: { a: "debug" } });

    expect(storage.items.get("app.log")).toBe("a:debug");
  });

  test("nothing stored yet saves the change alone", () => {
    const storage = fakeStorage();
    const { handle } = install("app.log", storage);

    handle("a:debug");

    expect(storage.items.get("app.log")).toBe("a:debug");
  });

  test("blocked storage keeps the change for this page only and says so", () => {
    const storage = fakeStorage({}, true);
    const { handle, confirmed, overrides } = install("app.log", storage);

    handle("a:debug");

    expect({ ...overrides() }).toEqual({ a: "debug" });
    expect(confirmed[0]).toBe("Logger levels changed: *:warn, a:debug. Not saved: storage is blocked, so this applies to this page only.");
  });

  test("missing storage counts as blocked", () => {
    const { handle, confirmed } = install("app.log", {});

    handle("a:debug");

    expect(confirmed[0]).toContain("Not saved: storage is blocked");
  });

  test("nothing is written while browser sources are not enabled", () => {
    const storage = fakeStorage({ "vipengele.log": "x:info" });
    const { handle, confirmed } = install(null, storage);

    handle("a:debug");
    handle(null);

    expect(storage.items.get("vipengele.log")).toBe("x:info");
    expect(confirmed[0]).toContain("Not saved: the configuration in force reads no browser sources");
    expect(confirmed[1]).toBe("Logger overrides removed. Levels: *:warn.");
  });

  test("null removes the stored spec and says the levels it set stay until the next configure or reload", () => {
    const storage = fakeStorage({ "app.log": "a:debug" });
    const { handle, confirmed, overrides } = install("app.log", storage);
    handle("b:info");

    handle(null);

    expect(storage.items.has("app.log")).toBe(false);
    expect({ ...overrides() }).toEqual({});
    expect(confirmed[1]).toBe(
      'Logger overrides removed. Levels: *:warn. Removed the spec stored under localStorage "app.log"; levels it set when the page ' +
        "loaded stay in force until the next configure or reload.",
    );
  });

  test("null with blocked storage removes the overrides and says the stored spec stays", () => {
    const storage = fakeStorage({ "app.log": "a:debug" }, true);
    const { handle, confirmed } = install("app.log", storage);

    handle(null);

    expect(storage.items.get("app.log")).toBe("a:debug");
    expect(confirmed[0]).toBe(
      'Logger overrides removed. Levels: *:warn. Could not remove the spec stored under localStorage "app.log": storage is blocked.',
    );
  });

  test("the stored spec round-trips through parseSpec", () => {
    const storage = fakeStorage();
    const { handle } = install("app.log", storage);
    const levels: Record<string, Threshold> = { "*": "info", "a.b": "off" };

    handle({ levels });

    expect(storage.items.get("app.log")).toBe("*:info,a.b:off");
  });
});
