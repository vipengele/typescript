import type { Threshold } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { entryFor, resolveEntry } from "./levels";
import { createSettings, DEFAULT_LEVELS, EMPTY_LAYER, flattenLayers, freezeLayer, LAYER_ORDER, type LevelLayer } from "./settings";

const proto = "__proto__";

describe("LAYER_ORDER", () => {
  test("lists defaults, builder and overrides, lowest precedence first", () => {
    expect(LAYER_ORDER).toEqual(["defaults", "builder", "overrides"]);
    expect(Object.isFrozen(LAYER_ORDER)).toBe(true);
  });
});

describe("DEFAULT_LEVELS and EMPTY_LAYER", () => {
  test("the defaults put the root at warn", () => {
    expect({ ...DEFAULT_LEVELS }).toEqual({ "*": "warn" });
    expect(Object.isFrozen(DEFAULT_LEVELS)).toBe(true);
    expect(Object.getPrototypeOf(DEFAULT_LEVELS)).toBeNull();
  });

  test("the empty layer holds nothing", () => {
    expect(Object.keys(EMPTY_LAYER)).toEqual([]);
    expect(Object.isFrozen(EMPTY_LAYER)).toBe(true);
    expect(Object.getPrototypeOf(EMPTY_LAYER)).toBeNull();
  });
});

describe("freezeLayer", () => {
  test("copies own entries into a frozen, prototype-less layer", () => {
    const source = { "*": "warn", react: "debug" };
    const layer = freezeLayer(source);
    source.react = "error";

    expect({ ...layer }).toEqual({ "*": "warn", react: "debug" });
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.getPrototypeOf(layer)).toBeNull();
  });

  test("keeps a __proto__ category as an own key", () => {
    const layer = freezeLayer(JSON.parse('{"__proto__":"debug"}'));

    expect(Object.hasOwn(layer, proto)).toBe(true);
    expect(layer[proto]).toBe("debug");
    expect(Object.getPrototypeOf(layer)).toBeNull();
  });

  test("throws a LoggingConfigError on an invalid category key", () => {
    expect(() => freezeLayer({ "a..b": "info" })).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("throws a LoggingConfigError on an invalid threshold", () => {
    expect(() => freezeLayer({ a: "loud" })).toThrow(expect.toSatisfy(isLoggingConfigError));
    expect(() => freezeLayer({ a: "constructor" })).toThrow(expect.toSatisfy(isLoggingConfigError));
  });
});

describe("flattenLayers", () => {
  test("a later layer's entry replaces an earlier one's for the same category", () => {
    const table = flattenLayers([freezeLayer({ "*": "warn", a: "info" }), freezeLayer({ a: "debug", b: "off" })]);

    expect({ ...table }).toEqual({ "*": entryFor("warn"), a: entryFor("debug"), b: entryFor("off") });
  });

  test("returns a frozen, prototype-less table of frozen entries", () => {
    const table = flattenLayers([DEFAULT_LEVELS]);

    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.getPrototypeOf(table)).toBeNull();
    expect(Object.isFrozen(table["*"])).toBe(true);
  });

  test("returns an empty table for no layers", () => {
    expect(Object.keys(flattenLayers([]))).toEqual([]);
  });

  test("carries a __proto__ category as an own entry", () => {
    const table = flattenLayers([freezeLayer(JSON.parse('{"__proto__":"trace"}'))]);

    expect(Object.hasOwn(table, proto)).toBe(true);
    expect(table[proto]).toEqual(entryFor("trace"));
    expect(resolveEntry(table, `${proto}.child`)).toEqual(entryFor("trace"));
  });

  test("does not change the layers it reads", () => {
    const layers: LevelLayer[] = [freezeLayer({ a: "info" }), freezeLayer({ a: "error" })];
    flattenLayers(layers);

    expect(layers.map((layer) => ({ ...layer }))).toEqual([{ a: "info" }, { a: "error" }]);
  });
});

describe("createSettings", () => {
  test("exposes every layer and the effective table, overrides winning over builder over defaults", () => {
    const settings = createSettings({
      defaults: { "*": "warn" },
      builder: { "*": "info", react: "debug", vue: "error" },
      overrides: { react: "trace" },
    });

    expect({ ...settings.layers.defaults }).toEqual({ "*": "warn" });
    expect({ ...settings.layers.builder }).toEqual({ "*": "info", react: "debug", vue: "error" });
    expect({ ...settings.layers.overrides }).toEqual({ react: "trace" });
    expect({ ...settings.levels }).toEqual({ "*": entryFor("info"), react: entryFor("trace"), vue: entryFor("error") });
  });

  test("a lower layer shows through where no higher layer sets the category", () => {
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: { a: "debug" }, overrides: {} });

    expect(resolveEntry(settings.levels, "b")).toEqual(entryFor("warn"));
    expect(resolveEntry(settings.levels, "a.x")).toEqual(entryFor("debug"));
  });

  test("a table with no root resolves an ungoverned category to undefined", () => {
    const settings = createSettings({ defaults: EMPTY_LAYER, builder: { a: "debug" }, overrides: {} });

    expect(resolveEntry(settings.levels, "b")).toBeUndefined();
  });

  test("is frozen throughout and prototype-less where it is keyed by category", () => {
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: { a: "info" }, overrides: { b: "off" } });

    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.layers)).toBe(true);
    expect(Object.isFrozen(settings.levels)).toBe(true);
    expect(Object.getPrototypeOf(settings.levels)).toBeNull();
    for (const name of LAYER_ORDER) {
      expect(Object.isFrozen(settings.layers[name])).toBe(true);
      expect(Object.getPrototypeOf(settings.layers[name])).toBeNull();
    }
  });

  test("is independent of later changes to the objects it was built from", () => {
    const overrides: Record<string, Threshold> = { a: "debug" };
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides });
    overrides.a = "fatal";
    overrides.b = "trace";

    expect({ ...settings.layers.overrides }).toEqual({ a: "debug" });
    expect({ ...settings.levels }).toEqual({ "*": entryFor("warn"), a: entryFor("debug") });
  });

  test("throws a LoggingConfigError when a layer holds an invalid entry", () => {
    expect(() => createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides: { a: "loud" } })).toThrow(
      expect.toSatisfy(isLoggingConfigError),
    );
  });
});
