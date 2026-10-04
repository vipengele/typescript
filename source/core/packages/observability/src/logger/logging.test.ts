import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { createLogger, type Logger } from "./logger";
import { Logging, setWarnTarget } from "./logging";
import { createLoggerProvider, type LoggerProvider } from "./provider";
import type { EmitSettings, Sink } from "./record";
import { publishLevelTable, resolveSharedEntry } from "./slots";

vi.mock("./logger", { spy: true });

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");
const registry = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
  setWarnTarget(undefined);
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

function sink(): Sink {
  return { write: () => {} };
}

/** The emit settings getter the provider handed to `createLogger` when it made `logger`. */
function emitOf(logger: Logger): () => EmitSettings {
  const index = vi.mocked(createLogger).mock.results.findIndex((result) => result.value === logger);
  return vi.mocked(createLogger).mock.calls[index]?.[2] as () => EmitSettings;
}

const RESOURCE: Resource = {
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "process.runtime.name": "node",
};

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

describe("sinks", () => {
  test("only the level table reaches the levels slot when a configure sets sinks", () => {
    Logging.configure((b) => b.addLevels({ app: "debug" }).addSink(sink()));

    const published = registry[LEVELS_SLOT] as Record<string, unknown>;
    expect(Object.keys(published).sort()).toEqual(["*", "app"]);
    expect(published.app).toEqual({ level: "debug", severity: expect.any(Number) });
  });

  test("a configure on the default provider replaces its sinks", () => {
    const [first, second] = [sink(), sink()];
    const emit = emitOf(Logging.logger("app"));

    Logging.configure((b) => b.addSink(first));
    expect(emit().sinks).toEqual([first]);

    const settings = Logging.configure((b) => b.addSink(second));
    expect(settings.sinks).toEqual([second]);
    expect(emit().sinks).toEqual([second]);
  });

  test("a created provider's sinks are shared with neither the default provider nor another created provider", () => {
    const [mine, theirs, defaults] = [sink(), sink(), sink()];
    Logging.configure((b) => b.addSink(defaults));
    const one = Logging.createProvider((b) => b.addSink(mine));
    const other = Logging.createProvider();

    other.configure((b) => b.addSink(theirs));

    expect(emitOf(Logging.logger("app"))().sinks).toEqual([defaults]);
    expect(emitOf(one.logger("app"))().sinks).toEqual([mine]);
    expect(emitOf(other.logger("app"))().sinks).toEqual([theirs]);
  });
});

describe("resource", () => {
  test("the default provider's records carry Scope.resource(), asked on every call", () => {
    const resource = vi.spyOn(Scope, "resource").mockReturnValue(RESOURCE);
    const emit = emitOf(Logging.logger("app"));

    expect(emit().resource()).toBe(RESOURCE);
    emit().resource();
    expect(resource).toHaveBeenCalledTimes(2);
  });

  test("a created provider's records carry Scope.resource()", () => {
    vi.spyOn(Scope, "resource").mockReturnValue(RESOURCE);

    expect(emitOf(Logging.createProvider().logger("app"))().resource()).toBe(RESOURCE);
  });
});

describe("sink errors", () => {
  test.for([
    ["an Error", new TypeError("sink down"), "TypeError: sink down"],
    ["a string", "offline", "offline"],
    ["a number", 503, "503"],
    ["a symbol", Symbol("gone"), "Symbol(gone)"],
    ["a prototype-less object", Object.create(null), "a value of type object"],
  ])("reach the warn target as one sentence for %s", ([, thrown, detail]) => {
    const target = vi.fn();
    setWarnTarget(target);

    emitOf(Logging.logger("app"))().onSinkError(thrown);

    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledWith(`A log sink threw while writing a record: ${detail}`);
  });

  test("are reported every time, not once", () => {
    const target = vi.fn();
    setWarnTarget(target);
    const emit = emitOf(Logging.logger("app"));

    emit().onSinkError(new Error("again"));
    emit().onSinkError(new Error("again"));

    expect(target).toHaveBeenCalledTimes(2);
  });

  test("an Error whose message cannot be read is described by its type", () => {
    const target = vi.fn();
    setWarnTarget(target);
    const thrown = new Error("hidden");
    Object.defineProperty(thrown, "message", {
      get() {
        throw new Error("no message");
      },
    });

    emitOf(Logging.logger("app"))().onSinkError(thrown);

    expect(target).toHaveBeenCalledWith("A log sink threw while writing a record: a value of type object");
  });

  test("a created provider's sink errors reach the warn target", () => {
    const target = vi.fn();
    setWarnTarget(target);

    emitOf(Logging.createProvider().logger("app"))().onSinkError(new Error("down"));

    expect(target).toHaveBeenCalledWith("A log sink threw while writing a record: Error: down");
  });

  test("console.warn receives them when no target is injected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    emitOf(Logging.logger("app"))().onSinkError(new Error("down"));

    expect(warn).toHaveBeenCalledWith("A log sink threw while writing a record: Error: down");
  });
});
