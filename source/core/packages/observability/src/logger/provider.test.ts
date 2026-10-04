import type { Threshold } from "@vipengele/ts-core-common";
import { describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { entryFor } from "./levels";
import { createLoggerProvider } from "./provider";
import type { LoggingSettings } from "./settings";

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");
const registry = globalThis as unknown as Record<symbol, unknown>;

const isConfigError = expect.toSatisfy(isLoggingConfigError);

function layersOf(settings: LoggingSettings): Record<string, Record<string, Threshold>> {
  return {
    defaults: { ...settings.layers.defaults },
    builder: { ...settings.layers.builder },
    overrides: { ...settings.layers.overrides },
  };
}

describe("createLoggerProvider", () => {
  test("starts from the defaults: every category at warn", () => {
    const provider = createLoggerProvider();
    const logger = provider.logger("anything.at.all");

    expect(logger.enabled("info")).toBe(false);
    expect(logger.enabled("warn")).toBe(true);
  });

  test("starts from the configure callback when one is given", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ services: "debug" }));

    expect(provider.logger("services.editing").enabled("debug")).toBe(true);
    expect(provider.logger("other").enabled("info")).toBe(false);
  });

  test("an invalid starting configuration throws a LoggingConfigError", () => {
    expect(() => createLoggerProvider((b) => b.addLevels({ a: "loud" as Threshold }))).toThrow(isConfigError);
  });

  test("reports the starting configuration's issues, and publishes nothing", () => {
    const onIssues = vi.fn();
    const publish = vi.fn();

    createLoggerProvider((b) => b.addSpec("a:loud"), { onIssues, publish });

    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0]?.[0]).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
  });

  test("an isolated provider never touches either globalThis slot", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ a: "info" }));
    provider.configure((b) => b.addSpec("b:debug"));
    provider.override("c", "trace");
    provider.logger("a.b").enabled("info");
    provider.reset();
    provider.logger("c").enabled("trace");

    expect(Object.hasOwn(registry, LEVELS_SLOT)).toBe(false);
    expect(Object.hasOwn(registry, PROVIDER_SLOT)).toBe(false);
  });
});

describe("resolution through loggers", () => {
  test("the longest dot-boundary prefix wins", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "error", react: "info", "react.dom": "trace" }));

    expect(provider.logger("react.dom.events").enabled("trace")).toBe(true);
    expect(provider.logger("react.native").enabled("info")).toBe(true);
    expect(provider.logger("react.native").enabled("debug")).toBe(false);
    expect(provider.logger("vue").enabled("warn")).toBe(false);
  });

  test("react governs react and react.x, never reactive", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ react: "debug" }));

    expect(provider.logger("react").enabled("debug")).toBe(true);
    expect(provider.logger("react.x").enabled("debug")).toBe(true);
    expect(provider.logger("reactive").enabled("debug")).toBe(false);
  });

  test("is case-sensitive", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ react: "debug" }));

    expect(provider.logger("React").enabled("debug")).toBe(false);
  });

  test("falls back to warn when no key and no root govern a category", () => {
    const provider = createLoggerProvider((b) => b.clearDefaults().addLevels({ a: "trace" }));
    const logger = provider.logger("b");

    expect(logger.enabled("info")).toBe(false);
    expect(logger.enabled("warn")).toBe(true);
  });

  test("loggers created before a change see it", () => {
    const provider = createLoggerProvider();
    const logger = provider.logger("services");

    provider.configure((b) => b.addLevels({ services: "debug" }));
    expect(logger.enabled("debug")).toBe(true);

    provider.override("services", "off");
    expect(logger.enabled("fatal")).toBe(false);

    provider.reset();
    expect(logger.enabled("warn")).toBe(true);
    expect(logger.enabled("info")).toBe(false);
  });

  test("logger throws a LoggingConfigError on an invalid category, the root included", () => {
    const provider = createLoggerProvider();

    expect(() => provider.logger("*")).toThrow(isConfigError);
    expect(() => provider.logger("a..b")).toThrow(isConfigError);
  });

  test("a supplied resolve replaces the provider's own table, asked on every call", () => {
    let threshold: Threshold = "error";
    const resolve = vi.fn(() => entryFor(threshold));
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "trace" }), { resolve });
    const logger = provider.logger("a.b");

    expect(logger.enabled("warn")).toBe(false);
    threshold = "debug";
    expect(logger.enabled("debug")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledWith("a.b");
  });
});

describe("configure", () => {
  test("rebuilds from the defaults every time", () => {
    const provider = createLoggerProvider((b) => b.clearDefaults().addLevels({ a: "info" }));

    const settings = provider.configure((b) => b.addLevels({ b: "debug" }));

    expect(layersOf(settings)).toEqual({ defaults: { "*": "warn" }, builder: { b: "debug" }, overrides: {} });
    expect(provider.logger("a").enabled("info")).toBe(false);
  });

  test("applies the builder the callback mutated, whatever the callback returns", () => {
    const provider = createLoggerProvider();

    const settings = provider.configure((b) => {
      b.addLevels({ a: "trace" });
    });

    expect({ ...settings.layers.builder }).toEqual({ a: "trace" });
  });

  test("keeps existing overrides", () => {
    const provider = createLoggerProvider();
    provider.override("a", "trace");

    const settings = provider.configure((b) => b.addLevels({ a: "error" }));

    expect({ ...settings.layers.overrides }).toEqual({ a: "trace" });
    expect(provider.logger("a").enabled("trace")).toBe(true);
  });

  test("applies whole or not at all: a bad level throws and leaves the configuration in force", () => {
    const publish = vi.fn();
    const onIssues = vi.fn();
    const provider = createLoggerProvider((b) => b.addLevels({ a: "info" }), { publish, onIssues });
    provider.override("b", "debug");
    const logger = provider.logger("a");

    expect(() => provider.configure((b) => b.addSpec("bad").addLevels({ a: "trace", c: "loud" as Threshold }))).toThrow(isConfigError);
    expect(() => provider.configure((b) => b.addLevels({ "a..b": "trace" }))).toThrow(isConfigError);

    expect(logger.enabled("info")).toBe(true);
    expect(logger.enabled("debug")).toBe(false);
    expect(provider.logger("b").enabled("debug")).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(onIssues).not.toHaveBeenCalled();
  });

  test("a callback that throws leaves the configuration in force", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ a: "info" }));
    const failure = new Error("boom");

    expect(() =>
      provider.configure((b) => {
        b.addLevels({ a: "trace" });
        throw failure;
      }),
    ).toThrow(failure);
    expect(provider.logger("a").enabled("debug")).toBe(false);
  });

  test("reports the build's issues once per call, and not at all when there are none", () => {
    const onIssues = vi.fn();
    const provider = createLoggerProvider(undefined, { onIssues });

    provider.configure((b) => b.addSpec("a:loud,b:debug").addSpec("c"));
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0]?.[0]).toHaveLength(2);

    provider.configure((b) => b.addSpec("a:info"));
    expect(onIssues).toHaveBeenCalledTimes(1);

    provider.configure((b) => b.addSpec("x"));
    expect(onIssues).toHaveBeenCalledTimes(2);
  });

  test("reports issues after the new configuration is in force", () => {
    expect.assertions(1);
    const provider = createLoggerProvider(undefined, {
      onIssues: () => {
        expect(provider.logger("b").enabled("debug")).toBe(true);
      },
    });

    provider.configure((b) => b.addSpec("a:loud,b:debug"));
  });
});

describe("override", () => {
  test("an override beats the builder", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ a: "error" }));

    provider.override("a", "debug");

    expect(provider.logger("a").enabled("debug")).toBe(true);
  });

  test("null removes the override and lets the layers beneath show through", () => {
    const provider = createLoggerProvider((b) => b.addLevels({ a: "error" }));
    provider.override("a", "debug");
    provider.override("b", "trace");

    const settings = provider.override("a", null);

    expect({ ...settings.layers.overrides }).toEqual({ b: "trace" });
    expect(provider.logger("a").enabled("warn")).toBe(false);
    expect(provider.logger("a").enabled("error")).toBe(true);
  });

  test("null for a category with no override changes nothing", () => {
    const provider = createLoggerProvider();

    const settings = provider.override("a", null);

    expect(Object.keys(settings.layers.overrides)).toEqual([]);
  });

  test("accepts the root", () => {
    const provider = createLoggerProvider();

    provider.override("*", "trace");

    expect(provider.logger("anything").enabled("trace")).toBe(true);
  });

  test("keeps a __proto__ category as an own key", () => {
    const provider = createLoggerProvider();

    const settings = provider.override("__proto__", "trace");

    expect(Object.hasOwn(settings.layers.overrides, "__proto__")).toBe(true);
    expect(provider.logger("__proto__").enabled("trace")).toBe(true);
    expect(provider.logger("constructor").enabled("trace")).toBe(false);
  });

  test("throws a LoggingConfigError on an invalid category or level, changing nothing", () => {
    const publish = vi.fn();
    const provider = createLoggerProvider(undefined, { publish });

    expect(() => provider.override("a..b", "info")).toThrow(isConfigError);
    expect(() => provider.override("a", "loud" as Threshold)).toThrow(isConfigError);
    expect(() => provider.override("a", "constructor" as Threshold)).toThrow(isConfigError);
    expect(() => provider.override("a", undefined as unknown as Threshold)).toThrow(isConfigError);

    expect(publish).not.toHaveBeenCalled();
    expect(Object.keys(provider.reset().layers.overrides)).toEqual([]);
  });
});

describe("reset", () => {
  test("drops overrides and the builder layer and restores the defaults", () => {
    const provider = createLoggerProvider((b) => b.clearDefaults().addLevels({ a: "trace" }));
    provider.override("b", "debug");

    const settings = provider.reset();

    expect(layersOf(settings)).toEqual({ defaults: { "*": "warn" }, builder: {}, overrides: {} });
    expect(provider.logger("a").enabled("info")).toBe(false);
    expect(provider.logger("b").enabled("info")).toBe(false);
  });
});

describe("snapshots", () => {
  test("are frozen", () => {
    const settings = createLoggerProvider().override("a", "info");

    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.layers)).toBe(true);
    expect(Object.isFrozen(settings.layers.overrides)).toBe(true);
    expect(Object.isFrozen(settings.levels)).toBe(true);
  });

  test("never change after they are returned", () => {
    const provider = createLoggerProvider();
    const first = provider.configure((b) => b.addLevels({ a: "info" }));

    const second = provider.override("a", "trace");
    provider.reset();

    expect(first).not.toBe(second);
    expect(layersOf(first)).toEqual({ defaults: { "*": "warn" }, builder: { a: "info" }, overrides: {} });
    expect(first.levels.a).toEqual(entryFor("info"));
    expect(layersOf(second)).toEqual({ defaults: { "*": "warn" }, builder: { a: "info" }, overrides: { a: "trace" } });
    expect(second.levels.a).toEqual(entryFor("trace"));
  });

  test("are published after every configure, override and reset", () => {
    const publish = vi.fn();
    const provider = createLoggerProvider(undefined, { publish });

    const configured = provider.configure((b) => b.addLevels({ a: "info" }));
    const overridden = provider.override("a", "debug");
    const removed = provider.override("a", null);
    const reset = provider.reset();

    expect(publish.mock.calls.map(([settings]) => settings)).toEqual([configured, overridden, removed, reset]);
    expect(publish.mock.calls[0]?.[0]).toBe(configured);
  });

  test("are published before the configure's issues are reported", () => {
    const order: string[] = [];
    const provider = createLoggerProvider(undefined, {
      publish: () => order.push("publish"),
      onIssues: () => order.push("issues"),
    });

    provider.configure((b) => b.addSpec("bad"));

    expect(order).toEqual(["publish", "issues"]);
  });
});
