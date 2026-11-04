import { systemClock, type Threshold } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { entryFor, resolveEntry } from "./levels";
import type { LogProcessor, Sink, SinkRegistration } from "./record";
import {
  createSettings,
  DEFAULT_LEVELS,
  defaultOutput,
  defaultRedaction,
  EMPTY_LAYER,
  EMPTY_POLICY_LAYERS,
  flattenLayers,
  freezeLayer,
  freezeRegistration,
  LAYER_ORDER,
  type LevelLayer,
} from "./settings";

const proto = "__proto__";

describe("LAYER_ORDER", () => {
  test("lists defaults, builder, overrides and environment, lowest precedence first", () => {
    expect(LAYER_ORDER).toEqual(["defaults", "builder", "overrides", "environment"]);
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
  test("exposes every layer and the effective table, environment winning over overrides over builder over defaults", () => {
    const settings = createSettings({
      defaults: { "*": "warn" },
      builder: { "*": "info", react: "debug", vue: "error", svelte: "info" },
      overrides: { react: "trace", vue: "debug" },
      environment: { vue: "off", svelte: "fatal" },
    });

    expect({ ...settings.layers.defaults }).toEqual({ "*": "warn" });
    expect({ ...settings.layers.builder }).toEqual({ "*": "info", react: "debug", vue: "error", svelte: "info" });
    expect({ ...settings.layers.overrides }).toEqual({ react: "trace", vue: "debug" });
    expect({ ...settings.layers.environment }).toEqual({ vue: "off", svelte: "fatal" });
    expect({ ...settings.levels }).toEqual({
      "*": entryFor("info"),
      react: entryFor("trace"),
      vue: entryFor("off"),
      svelte: entryFor("fatal"),
    });
  });

  test("a lower layer shows through where no higher layer sets the category", () => {
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: { a: "debug" }, overrides: {}, environment: {} });

    expect(resolveEntry(settings.levels, "b")).toEqual(entryFor("warn"));
    expect(resolveEntry(settings.levels, "a.x")).toEqual(entryFor("debug"));
  });

  test("a table with no root resolves an ungoverned category to undefined", () => {
    const settings = createSettings({ defaults: EMPTY_LAYER, builder: { a: "debug" }, overrides: {}, environment: {} });

    expect(resolveEntry(settings.levels, "b")).toBeUndefined();
  });

  test("is frozen throughout and prototype-less where it is keyed by category", () => {
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: { a: "info" }, overrides: { b: "off" }, environment: {} });

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
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides, environment: {} });
    overrides.a = "fatal";
    overrides.b = "trace";

    expect({ ...settings.layers.overrides }).toEqual({ a: "debug" });
    expect({ ...settings.levels }).toEqual({ "*": entryFor("warn"), a: entryFor("debug") });
  });

  test("throws a LoggingConfigError when a layer holds an invalid entry", () => {
    expect(() => createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides: { a: "loud" }, environment: {} })).toThrow(
      expect.toSatisfy(isLoggingConfigError),
    );
  });
});

describe("createSettings output", () => {
  test("defaults to no sinks, no processors, the system clock and the secretKeys redaction", () => {
    const settings = createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} });

    expect(settings.sinks).toEqual([]);
    expect(Object.isFrozen(settings.sinks)).toBe(true);
    expect(settings.processors).toEqual([]);
    expect(Object.isFrozen(settings.processors)).toBe(true);
    expect(settings.clock).toBe(systemClock);
    expect(settings.redaction).toBe(secretKeys);
    expect(settings.random).toBe(Math.random);
    expect(settings.browserSources).toBeNull();
  });

  test("holds the random source by reference, and falls back to Math.random when the output has none", () => {
    const random = () => 0.5;
    const { random: _omitted, ...withoutRandom } = defaultOutput();

    const given = createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} }, { ...defaultOutput(), random });
    const omitted = createSettings({ defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} }, withoutRandom);

    expect(given.random).toBe(random);
    expect(omitted.random).toBe(Math.random);
  });

  test("copies the browser sources into a frozen object", () => {
    const browserSources = { storageKey: "app.log" };

    const settings = createSettings(
      { defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} },
      { ...defaultOutput(), browserSources },
    );
    browserSources.storageKey = "other.log";

    expect(settings.browserSources).toEqual({ storageKey: "app.log" });
    expect(Object.isFrozen(settings.browserSources)).toBe(true);
  });

  test("carries null browser sources through", () => {
    const settings = createSettings(
      { defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} },
      { ...defaultOutput(), browserSources: null },
    );

    expect(settings.browserSources).toBeNull();
  });

  test("copies the sink registrations and processor lists into frozen arrays and holds the clock and policy by reference", () => {
    const sink: Sink = { write: () => {} };
    const perSink: LogProcessor = (record) => record;
    const global: LogProcessor = (record) => record;
    const sinkProcessors = [perSink];
    const registration: SinkRegistration = { sink, processors: sinkProcessors };
    const sinks = [registration];
    const processors = [global];
    const clock = () => 1;
    const policy = { keys: ["ssn"] };

    const settings = createSettings(
      { defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} },
      { sinks, processors, clock, redaction: policy },
    );
    sinks.push({ sink: { write: () => {} }, processors: [] });
    sinkProcessors.push(global);
    processors.push(perSink);

    expect(settings.sinks).toEqual([{ sink, processors: [perSink] }]);
    expect(settings.sinks).not.toBe(sinks);
    expect(Object.isFrozen(settings.sinks)).toBe(true);
    expect(settings.sinks[0]).not.toBe(registration);
    expect(settings.sinks[0]?.sink).toBe(sink);
    expect(Object.isFrozen(settings.sinks[0])).toBe(true);
    expect(Object.isFrozen(settings.sinks[0]?.processors)).toBe(true);
    expect(settings.processors).toEqual([global]);
    expect(Object.isFrozen(settings.processors)).toBe(true);
    expect(settings.clock).toBe(clock);
    expect(settings.redaction).toBe(policy);
  });

  test("carries a null redaction through", () => {
    const settings = createSettings(
      { defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} },
      { ...defaultOutput(), redaction: null },
    );

    expect(settings.redaction).toBeNull();
  });
});

describe("createSettings policy", () => {
  const levels = { defaults: DEFAULT_LEVELS, builder: {}, overrides: {}, environment: {} };

  test("defaults to every policy layer empty and an empty policy table", () => {
    const settings = createSettings(levels);

    for (const name of LAYER_ORDER) {
      expect(Object.keys(settings.policyLayers[name].sample)).toEqual([]);
      expect(Object.keys(settings.policyLayers[name].rateLimit)).toEqual([]);
    }
    expect(Object.keys(settings.policy.sample)).toEqual([]);
    expect(Object.keys(settings.policy.rateLimit)).toEqual([]);
  });

  test("flattens the policy layers in layer order, a later layer's rule for a key winning", () => {
    const settings = createSettings(levels, defaultOutput(), {
      defaults: { sample: { "*": 0.9 } },
      builder: { sample: { a: 0.5, b: 0.5 }, rateLimit: { a: { burst: 1, perMinute: 1 } } },
      overrides: { sample: { a: 0.2 } },
      environment: { rateLimit: { a: false } },
    });

    expect({ ...settings.policy.sample }).toEqual({
      "*": { rate: 0.9, upTo: "info" },
      a: { rate: 0.2, upTo: "info" },
      b: { rate: 0.5, upTo: "info" },
    });
    expect({ ...settings.policy.rateLimit }).toEqual({ a: false });
  });

  test("copies each policy layer into a frozen layer, independent of the objects passed in", () => {
    const sample: Record<string, number> = { a: 0.5 };

    const settings = createSettings(levels, defaultOutput(), { ...EMPTY_POLICY_LAYERS, builder: { sample } });
    sample.a = 0.1;

    expect(Object.isFrozen(settings.policyLayers)).toBe(true);
    expect(Object.isFrozen(settings.policyLayers.builder)).toBe(true);
    expect(Object.isFrozen(settings.policyLayers.builder.sample)).toBe(true);
    expect({ ...settings.policyLayers.builder.sample }).toEqual({ a: { rate: 0.5, upTo: "info" } });
    expect(Object.isFrozen(settings.policy)).toBe(true);
  });

  test("throws a LoggingConfigError on a layer holding an invalid rule", () => {
    expect(() => createSettings(levels, defaultOutput(), { ...EMPTY_POLICY_LAYERS, overrides: { sample: { a: 2 } } })).toThrow(
      expect.toSatisfy(isLoggingConfigError),
    );
  });
});

describe("EMPTY_POLICY_LAYERS", () => {
  test("is frozen and holds every layer, each with no rule", () => {
    expect(Object.isFrozen(EMPTY_POLICY_LAYERS)).toBe(true);
    expect(Object.keys(EMPTY_POLICY_LAYERS)).toEqual([...LAYER_ORDER]);
    for (const name of LAYER_ORDER) {
      expect(Object.keys(EMPTY_POLICY_LAYERS[name].sample)).toEqual([]);
      expect(Object.keys(EMPTY_POLICY_LAYERS[name].rateLimit)).toEqual([]);
    }
  });
});

describe("defaultOutput", () => {
  test("is frozen, with frozen empty sink and processor lists", () => {
    const output = defaultOutput();

    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.sinks)).toBe(true);
    expect(output.sinks).toEqual([]);
    expect(Object.isFrozen(output.processors)).toBe(true);
    expect(output.processors).toEqual([]);
    expect(output.random).toBe(Math.random);
  });
});

describe("freezeRegistration", () => {
  test("is a frozen copy holding the sink by reference and a frozen copy of its processors", () => {
    const sink: Sink = { write: () => {} };
    const processor: LogProcessor = (record) => record;
    const processors = [processor];

    const frozen = freezeRegistration({ sink, processors });
    processors.push(processor);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.sink).toBe(sink);
    expect(frozen.processors).toEqual([processor]);
    expect(Object.isFrozen(frozen.processors)).toBe(true);
  });
});

describe("defaultRedaction", () => {
  test("is the secretKeys preset", () => {
    expect(defaultRedaction()).toBe(secretKeys);
  });
});
