import { afterEach, describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { Logging, setWarnTarget } from "./logging";
import { createLoggerProvider, type LoggerProvider } from "./provider";
import { publishLevelTable, resolveSharedEntry } from "./slots";

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");
const registry = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  setWarnTarget(undefined);
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

describe("module load", () => {
  test("importing the module touches neither slot", async () => {
    vi.resetModules();
    await import("./logging");
    expect(Object.hasOwn(globalThis, LEVELS_SLOT)).toBe(false);
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
  });

  test("the default provider is created by the first call that needs it", () => {
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
    Logging.logger("app");
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(true);
  });
});

describe("Logging", () => {
  test("configure, override and reset change what an existing Logger reports", () => {
    const logger = Logging.logger("app.db");
    expect(logger.category).toBe("app.db");
    expect(logger.enabled("info")).toBe(false);

    Logging.configure((b) => b.addLevels({ app: "debug" }));
    expect(logger.enabled("debug")).toBe(true);
    expect(logger.enabled("trace")).toBe(false);

    Logging.override("app.db", "off");
    expect(logger.enabled("fatal")).toBe(false);

    Logging.override("app.db", null);
    expect(logger.enabled("debug")).toBe(true);

    Logging.reset();
    expect(logger.enabled("debug")).toBe(false);
    expect(logger.enabled("warn")).toBe(true);
  });

  test("a bad level in code throws a LoggingConfigError", () => {
    expect(() => Logging.override("app", "loud" as never)).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("a Logger resolves through the levels slot on every call", () => {
    const logger = Logging.logger("app");
    registry[LEVELS_SLOT] = { "*": { level: "trace", severity: 10 } };
    expect(logger.enabled("trace")).toBe(true);
  });
});

describe("two copies of the package", () => {
  /** A second copy's default provider: the same wiring as `Logging`'s, held outside the provider slot. */
  function otherCopy(): LoggerProvider {
    return createLoggerProvider(undefined, {
      resolve: resolveSharedEntry,
      publish: (settings) => {
        publishLevelTable(settings.levels);
      },
    });
  }

  test("configure, override and reset in one copy reach the other's Loggers through the levels slot", () => {
    const other = otherCopy();
    const loggerHere = Logging.logger("app.db");
    const loggerThere = other.logger("app.db");

    other.configure((b) => b.addLevels({ app: "debug" }));
    expect(loggerHere.enabled("debug")).toBe(true);

    other.override("app.db", "off");
    expect(loggerHere.enabled("fatal")).toBe(false);

    other.override("app.db", null);
    expect(loggerHere.enabled("debug")).toBe(true);

    other.reset();
    expect(loggerHere.enabled("debug")).toBe(false);
    expect(loggerHere.enabled("warn")).toBe(true);

    Logging.configure((b) => b.addLevels({ app: "trace" }));
    expect(loggerThere.enabled("trace")).toBe(true);

    Logging.override("app.db", "error");
    expect(loggerThere.enabled("warn")).toBe(false);

    Logging.reset();
    expect(loggerThere.enabled("warn")).toBe(true);
    expect(loggerThere.enabled("info")).toBe(false);
  });

  test("a default provider another copy stored in the provider slot is the one Logging uses", () => {
    const theirs = otherCopy();
    registry[PROVIDER_SLOT] = theirs;
    const logger = Logging.logger("app");

    theirs.configure((b) => b.addLevels({ app: "trace" }));
    expect(logger.enabled("trace")).toBe(true);

    Logging.override("app", "off");
    expect(theirs.logger("app").enabled("fatal")).toBe(false);
    expect(registry[PROVIDER_SLOT]).toBe(theirs);
  });
});

describe("createProvider", () => {
  test("returns an isolated provider that touches neither slot", () => {
    const provider = Logging.createProvider((b) => b.addLevels({ "*": "trace" }));
    const logger = provider.logger("app");
    expect(logger.enabled("trace")).toBe(true);

    provider.override("app", "off");
    provider.reset();
    provider.configure((b) => b.addSpec("app:bad"));

    expect(Object.hasOwn(globalThis, LEVELS_SLOT)).toBe(false);
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
  });

  test("spec issues from the starting callback and a later configure reach the warn target once each", () => {
    const target = vi.fn();
    setWarnTarget(target);

    const provider = Logging.createProvider((b) => b.addSpec("a:nope").addSpec("a:nope"));
    const afterStart = target.mock.calls.length;
    expect(afterStart).toBe(1);

    provider.configure((b) => b.addSpec("b:alsobad").addSpec("b:alsobad"));
    expect(target.mock.calls.length).toBe(afterStart + 1);

    expect(Object.hasOwn(globalThis, LEVELS_SLOT)).toBe(false);
    expect(Object.hasOwn(globalThis, PROVIDER_SLOT)).toBe(false);
  });

  test("starts from the defaults without a callback and leaves the default provider alone", () => {
    const provider = Logging.createProvider();
    expect(provider.logger("app").enabled("info")).toBe(false);

    Logging.configure((b) => b.addLevels({ "*": "trace" }));
    expect(provider.logger("app").enabled("info")).toBe(false);
  });
});

describe("spec issues", () => {
  test("each distinct issue of a configure call reaches the warn target once", () => {
    const target = vi.fn();
    setWarnTarget(target);

    Logging.configure((b) => b.addSpec("a:nope").addSpec("a:nope").addSpec("b:alsobad"));

    const issues = target.mock.calls.map(([issue]) => issue as string);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(new Set(issues).size).toBe(issues.length);
  });

  test("a later configure call reports its issues again", () => {
    const target = vi.fn();
    setWarnTarget(target);

    Logging.configure((b) => b.addSpec("a:nope"));
    const afterFirst = target.mock.calls.length;
    Logging.configure((b) => b.addSpec("a:nope"));

    expect(afterFirst).toBeGreaterThan(0);
    expect(target.mock.calls.length).toBe(afterFirst * 2);
  });

  test("a clean configure reports nothing", () => {
    const target = vi.fn();
    setWarnTarget(target);
    Logging.configure((b) => b.addSpec("a:debug"));
    expect(target).not.toHaveBeenCalled();
  });

  test("the target is read when issues are reported, not when the provider is created", () => {
    Logging.logger("app");
    const target = vi.fn();
    setWarnTarget(target);
    Logging.configure((b) => b.addSpec("a:nope"));
    expect(target).toHaveBeenCalled();
  });

  test("console.warn receives the issues when no target is injected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      Logging.configure((b) => b.addSpec("a:nope"));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(typeof warn.mock.calls[0]?.[0]).toBe("string");
    } finally {
      warn.mockRestore();
    }
  });
});
