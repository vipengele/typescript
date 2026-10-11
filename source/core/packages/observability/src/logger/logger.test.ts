import type { Level, Threshold } from "@vipengele/ts-core-common";
import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { entryFor } from "./levels";
import { createLogger } from "./logger";
import { Logging, setWarnTarget } from "./logging";
import type { EmitSettings, LogRecord, Sink } from "./record";

/** Emit settings for a Logger whose `enabled` is under test; `enabled` never reads them. */
function emit(): EmitSettings {
  throw new Error("enabled never reads the emit settings");
}

describe("createLogger", () => {
  test("exposes its category, enabled, with and the six emit methods, and nothing else", () => {
    const logger = createLogger("services.editing", () => entryFor("warn"), emit);

    expect(logger.category).toBe("services.editing");
    expect(Object.keys(logger).sort()).toEqual(["category", "debug", "enabled", "error", "fatal", "info", "trace", "warn", "with"]);
    expect(Object.isFrozen(logger)).toBe(true);
  });

  test("enables a level at or above the resolved threshold", () => {
    const logger = createLogger("a", () => entryFor("info"), emit);

    expect(logger.enabled("debug")).toBe(false);
    expect(logger.enabled("info")).toBe(true);
    expect(logger.enabled("fatal")).toBe(true);
  });

  test("an off threshold enables nothing", () => {
    const logger = createLogger("a", () => entryFor("off"), emit);

    expect(logger.enabled("fatal")).toBe(false);
  });

  test("asks the resolver for its own category on every call", () => {
    let threshold: Threshold = "error";
    const asked: string[] = [];
    const logger = createLogger(
      "a.b",
      (category) => {
        asked.push(category);
        return entryFor(threshold);
      },
      emit,
    );

    expect(logger.enabled("warn")).toBe(false);
    threshold = "trace";
    expect(logger.enabled("warn")).toBe(true);
    expect(asked).toEqual(["a.b", "a.b"]);
  });

  test("throws a LoggingConfigError on an invalid category, the root included", () => {
    for (const category of ["", "*", "a..b", "a:b", "a,b", "a.*"]) {
      expect(() => createLogger(category, () => entryFor("warn"), emit)).toThrow(expect.toSatisfy(isLoggingConfigError));
    }
  });
});

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
});

/** A sink that keeps every record it is handed, and the emit settings that deliver to it. */
function collecting(overrides: Partial<EmitSettings> = {}): { readonly records: LogRecord[]; readonly settings: EmitSettings } {
  const records: LogRecord[] = [];
  const sink: Sink = {
    write(record) {
      records.push(record);
    },
  };
  return {
    records,
    settings: { sinks: [sink], clock: () => 42.5, redaction: null, resource: () => RESOURCE, onSinkError: () => {}, ...overrides },
  };
}

describe("Logger emit methods", () => {
  test("each of the six methods writes a record at its own level", () => {
    const { records, settings } = collecting();
    const logger = createLogger(
      "app",
      () => entryFor("trace"),
      () => settings,
    );
    const failure = new Error("boom");

    logger.trace("t", { n: 1 });
    logger.debug("d", { n: 2 });
    logger.info("i", { n: 3 });
    logger.warn("w", failure, { n: 4 });
    logger.error("e", failure, { n: 5 });
    logger.fatal("f", failure, { n: 6 });

    expect(records.map(({ level, message, attributes }) => [level, message, attributes])).toEqual([
      ["trace", "t", { n: 1 }],
      ["debug", "d", { n: 2 }],
      ["info", "i", { n: 3 }],
      ["warn", "w", { n: 4 }],
      ["error", "e", { n: 5 }],
      ["fatal", "f", { n: 6 }],
    ]);
    for (const record of records) {
      expect(record.category).toBe("app");
      expect(record.time).toBe(42.5);
    }
    for (const record of records.slice(0, 3)) {
      expect(Object.hasOwn(record, "error")).toBe(false);
    }
    for (const record of records.slice(3)) {
      expect(record.error).toMatchObject({ type: "Error", message: "boom" });
    }
  });

  test("warn, error and fatal without an error argument, or with undefined, carry no error", () => {
    const { records, settings } = collecting();
    const logger = createLogger(
      "app",
      () => entryFor("trace"),
      () => settings,
    );

    logger.warn("w");
    logger.error("e", undefined, { n: 1 });
    logger.fatal("f", null);

    expect(Object.hasOwn(records[0] as LogRecord, "error")).toBe(false);
    expect(Object.hasOwn(records[1] as LogRecord, "error")).toBe(false);
    expect(records[1]?.attributes).toEqual({ n: 1 });
    expect(records[2]?.error).toEqual({ type: "Error", message: "null", synthetic: true });
  });

  test("a disabled level reads neither the emit settings, the clock, the redaction policy, nor a sink", () => {
    const clock = vi.fn(() => 1);
    const resource = vi.fn(() => RESOURCE);
    const write = vi.fn();
    const keys = vi.fn(() => []);
    const redaction = {
      get keys() {
        return keys();
      },
    };
    const settings: EmitSettings = { sinks: [{ write }], clock, redaction, resource, onSinkError: () => {} };
    const read = vi.fn(() => settings);
    const logger = createLogger("app", () => entryFor("error"), read);

    logger.trace("t", { password: "p" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w", new Error("e"));

    expect(read).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    logger.error("e");
    expect(write).toHaveBeenCalledOnce();
  });

  test("reads the emit settings on every enabled call", () => {
    const first = collecting();
    const second = collecting();
    let current = first.settings;
    const logger = createLogger(
      "app",
      () => entryFor("info"),
      () => current,
    );

    logger.info("one");
    current = second.settings;
    logger.info("two");

    expect(first.records.map((record) => record.message)).toEqual(["one"]);
    expect(second.records.map((record) => record.message)).toEqual(["two"]);
  });

  test("the emit methods work as detached references", () => {
    const { records, settings } = collecting();
    const { info, error } = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    );

    info("detached");
    error("detached error", new Error("x"));

    expect(records.map((record) => [record.category, record.message])).toEqual([
      ["app", "detached"],
      ["app", "detached error"],
    ]);
  });

  test("a throwing sink, clock or redaction policy never reaches the caller", () => {
    const failing: Sink = {
      write() {
        throw new Error("sink");
      },
    };
    const clock = (): number => {
      throw new Error("clock");
    };
    const redaction = {
      get keys(): never {
        throw new Error("policy");
      },
    };
    const levels: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

    for (const overrides of [{ sinks: [failing] }, { clock }, { redaction }]) {
      const { settings } = collecting(overrides);
      const logger = createLogger(
        "app",
        () => entryFor("trace"),
        () => settings,
      );
      for (const level of levels) {
        expect(() => logger[level]("m", { user: "ada" })).not.toThrow();
      }
    }
  });
});

describe("Logger#with", () => {
  test("returns a new frozen Logger for the same category whose records carry the bound attributes", () => {
    const { records, settings } = collecting();
    const parent = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    );

    const child = parent.with({ requestId: "r-1" });
    child.info("handled", { status: 200 });
    parent.info("plain");

    expect(child).not.toBe(parent);
    expect(Object.isFrozen(child)).toBe(true);
    expect(child.category).toBe("app");
    expect(records.map(({ category, attributes }) => [category, attributes])).toEqual([
      ["app", { requestId: "r-1", status: 200 }],
      ["app", {}],
    ]);
  });

  test("a call's attribute wins over a bound attribute of the same key", () => {
    const { records, settings } = collecting();
    const logger = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    ).with({ requestId: "bound", user: "ada" });

    logger.info("m", { requestId: "call" });
    logger.error("e", new Error("x"), { user: "grace" });

    expect(records.map((record) => record.attributes)).toEqual([
      { requestId: "call", user: "ada" },
      { requestId: "bound", user: "grace" },
    ]);
  });

  test("a nested with overrides its parent's bindings and leaves the parent unchanged", () => {
    const { records, settings } = collecting();
    const parent = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    ).with({ requestId: "r-1", step: "outer" });

    const child = parent.with({ step: "inner", attempt: 2 });
    child.info("child");
    parent.info("parent");

    expect(records.map((record) => record.attributes)).toEqual([
      { requestId: "r-1", step: "inner", attempt: 2 },
      { requestId: "r-1", step: "outer" },
    ]);
  });

  test("a child follows a level changed after it was created", () => {
    const { records, settings } = collecting();
    let threshold: Threshold = "error";
    const child = createLogger(
      "app",
      () => entryFor(threshold),
      () => settings,
    ).with({ requestId: "r-1" });

    child.info("hidden");
    expect(child.enabled("info")).toBe(false);
    threshold = "info";
    child.info("shown");

    expect(child.enabled("info")).toBe(true);
    expect(records.map((record) => record.message)).toEqual(["shown"]);
  });

  test("a child reads the emit settings in force on every call", () => {
    const first = collecting();
    const second = collecting();
    let current = first.settings;
    const child = createLogger(
      "app",
      () => entryFor("info"),
      () => current,
    ).with({ requestId: "r-1" });

    child.info("one");
    current = second.settings;
    child.info("two");

    expect(first.records.map((record) => record.message)).toEqual(["one"]);
    expect(second.records.map((record) => record.message)).toEqual(["two"]);
  });

  test("mutating the object passed to with afterwards changes no record", () => {
    const { records, settings } = collecting();
    const bound = { user: { id: "u-1", roles: ["reader"] } };
    const logger = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    ).with(bound);

    bound.user.id = "u-2";
    bound.user.roles.push("admin");
    logger.info("m");

    expect(records[0]?.attributes).toEqual({ user: { id: "u-1", roles: ["reader"] } });
    expect(Object.isFrozen(records[0]?.attributes.user)).toBe(true);
  });

  test("a bound secret key is redacted when the record is emitted, under the policy then in force", () => {
    const redacting = collecting({ redaction: secretKeys });
    const plain = collecting();
    let current = plain.settings;
    const logger = createLogger(
      "app",
      () => entryFor("info"),
      () => current,
    ).with({ password: "hunter2", user: "ada" });

    logger.info("plain");
    current = redacting.settings;
    logger.info("redacted");

    expect(plain.records[0]?.attributes).toEqual({ password: "hunter2", user: "ada" });
    expect(redacting.records[0]?.attributes).toEqual({ password: "[REDACTED]", user: "ada" });
  });

  test("with works as a detached reference, and so do the child's methods", () => {
    const { records, settings } = collecting();
    const { with: bind } = createLogger(
      "app",
      () => entryFor("info"),
      () => settings,
    );

    const { info, with: bindAgain } = bind({ requestId: "r-1" });
    info("detached");
    bindAgain({ step: "s" }).info("nested");

    expect(records.map((record) => record.attributes)).toEqual([{ requestId: "r-1" }, { requestId: "r-1", step: "s" }]);
  });

  test("with no attributes returns the Logger itself", () => {
    const logger = createLogger(
      "app",
      () => entryFor("info"),
      () => collecting().settings,
    );
    const child = logger.with({ requestId: "r-1" });

    expect(logger.with({})).toBe(logger);
    expect(child.with({})).toBe(child);
  });

  test("at a disabled level a child reads neither its bindings, the emit settings, nor a sink", () => {
    const toJSON = vi.fn(() => "u-1");
    const write = vi.fn();
    const read = vi.fn(
      (): EmitSettings => ({ sinks: [{ write }], clock: () => 1, redaction: null, resource: () => RESOURCE, onSinkError: () => {} }),
    );
    let threshold: Threshold = "off";
    const child = createLogger("app", () => entryFor(threshold), read).with({ user: { toJSON } });

    expect(toJSON).toHaveBeenCalledOnce();
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
      child[level]("m");
    }

    expect(toJSON).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    threshold = "info";
    child.info("m");
    expect(toJSON).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatchObject({ attributes: { user: "u-1" } });
  });
});

describe("Logger through a provider", () => {
  afterEach(() => {
    setWarnTarget(undefined);
  });

  test("delivers records with the Scope resource, and reports a failing sink through the warn target", () => {
    const written: { record: LogRecord; resource: Resource }[] = [];
    const warnings: string[] = [];
    setWarnTarget((issue) => warnings.push(issue));
    const provider = Logging.createProvider((builder) =>
      builder
        .addLevels({ "*": "info" })
        .clock(() => 7.5)
        .addSink({
          write(record, resource) {
            written.push({ record, resource });
          },
        })
        .addSink({
          write() {
            throw new TypeError("sink offline");
          },
        }),
    );

    provider.logger("x").info("hello", { password: "hunter2", user: "ada" });
    provider.logger("x").debug("hidden");

    expect(written).toHaveLength(1);
    expect(written[0]?.record).toEqual({
      time: 7.5,
      level: "info",
      category: "x",
      message: "hello",
      attributes: { password: "[REDACTED]", user: "ada" },
    });
    expect(written[0]?.resource).toEqual(Scope.resource());
    expect(warnings).toEqual(["A log sink threw while writing a record: TypeError: sink offline"]);
  });

  test("delivers a Resource set through Scope.setResource after the Logger exists", () => {
    // The realm's root is the default scope's parent; its attribute bag is put back afterwards so
    // the Resource set here never reaches another test.
    const defaultScope = Scope.current() as unknown as Record<symbol, unknown>;
    const root = defaultScope[Symbol.for("vipengele:scope:parent")] as Record<symbol, unknown>;
    const attributes = Symbol.for("vipengele:scope:attributes");
    const original = root[attributes];
    const resources: Resource[] = [];
    const provider = Logging.createProvider((builder) =>
      builder.addLevels({ "*": "info" }).addSink({
        write(_record, resource) {
          resources.push(resource);
        },
      }),
    );
    const logger = provider.logger("x");

    try {
      Scope.setResource({ "service.name": "checkout", "service.version": "1.2.3" });
      logger.info("after");
    } finally {
      root[attributes] = original;
    }

    expect(resources).toHaveLength(1);
    expect(resources[0]?.["service.name"]).toBe("checkout");
    expect(resources[0]?.["service.version"]).toBe("1.2.3");
  });
});
