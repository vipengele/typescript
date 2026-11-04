import { systemClock, type Threshold } from "@vipengele/ts-core-common";
import { composePolicies, secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test } from "vitest";
import { createLoggingBuilder } from "./builder";
import { isLoggingConfigError } from "./config-error";
import type { RateLimitRule, SampleRule } from "./policy";
import type { LogProcessor, Sink } from "./record";
import { createSettings } from "./settings";

const proto = "__proto__";

function sink(): Sink {
  return { write: () => {} };
}

function processor(): LogProcessor {
  return (record) => record;
}

describe("createLoggingBuilder", () => {
  test("builds the defaults alone when nothing is added", () => {
    const build = createLoggingBuilder().build();

    expect({ ...build.defaults }).toEqual({ "*": "warn" });
    expect(Object.keys(build.builder)).toEqual([]);
    expect(build.sinks).toEqual([]);
    expect(build.processors).toEqual([]);
    expect(build.clock).toBe(systemClock);
    expect(build.redaction).toBe(secretKeys);
    expect(build.random).toBe(Math.random);
    expect(Object.keys(build.policy.sample)).toEqual([]);
    expect(Object.keys(build.policy.rateLimit)).toEqual([]);
    expect(build.ignoreEnvironment).toBe(false);
    expect(build.browserSources).toBeNull();
    expect(build.issues).toEqual([]);
  });

  test("every method but build returns the builder, so calls chain", () => {
    const builder = createLoggingBuilder();

    expect(builder.clearDefaults()).toBe(builder);
    expect(builder.ignoreEnvironment()).toBe(builder);
    expect(builder.addLevels({ a: "info" })).toBe(builder);
    expect(builder.addSpec("b:debug")).toBe(builder);
    expect(builder.addBrowserSources({ urlParameter: "unused.parameter", storageKey: "unused.key" })).toBe(builder);
    expect(builder.addSink(sink())).toBe(builder);
    expect(builder.addSink(sink(), { processors: [processor()] })).toBe(builder);
    expect(builder.addProcessor(processor())).toBe(builder);
    expect(builder.clock(() => 0)).toBe(builder);
    expect(builder.redaction(null)).toBe(builder);
    expect(builder.sample({ c: 0.5 })).toBe(builder);
    expect(builder.rateLimit({ c: { burst: 1, perMinute: 1 } })).toBe(builder);
    expect(builder.random(() => 0)).toBe(builder);
    expect({ ...builder.build().builder }).toEqual({ a: "info", b: "debug" });
  });

  test("returns frozen, prototype-less layers and frozen issues", () => {
    const build = createLoggingBuilder().addLevels({ a: "info" }).addSpec("bad").build();

    expect(Object.isFrozen(build)).toBe(true);
    expect(Object.isFrozen(build.builder)).toBe(true);
    expect(Object.getPrototypeOf(build.builder)).toBeNull();
    expect(Object.isFrozen(build.issues)).toBe(true);
    expect(Object.isFrozen(build.sinks)).toBe(true);
    expect(Object.isFrozen(build.processors)).toBe(true);
  });
});

describe("ignoreEnvironment", () => {
  test("marks the build as leaving the environment layer out, whatever else it sets", () => {
    const build = createLoggingBuilder().addLevels({ a: "info" }).ignoreEnvironment().clearDefaults().build();

    expect(build.ignoreEnvironment).toBe(true);
    expect({ ...build.builder }).toEqual({ a: "info" });
    expect(Object.keys(build.defaults)).toEqual([]);
  });

  test("clearDefaults alone keeps the environment layer", () => {
    expect(createLoggingBuilder().clearDefaults().build().ignoreEnvironment).toBe(false);
  });
});

describe("addBrowserSources", () => {
  test("malformed options make build throw a LoggingConfigError, in the order the sources were added", () => {
    const options = [null, "log", { urlParameter: "" }, { storageKey: 1 }] as unknown[];
    for (const option of options) {
      expect(() =>
        createLoggingBuilder()
          .addBrowserSources(option as never)
          .build(),
      ).toThrow(expect.toSatisfy(isLoggingConfigError));
    }

    expect(() =>
      createLoggingBuilder()
        .addBrowserSources(null as never)
        .addLevels({ a: "loud" as Threshold })
        .build(),
    ).toThrow("Invalid logger browser sources options of type null: expected an object.");
  });

  test("malformed options are recorded, never thrown when the call is made", () => {
    expect(() => createLoggingBuilder().addBrowserSources(null as never)).not.toThrow();
  });
});

describe("clearDefaults", () => {
  test("empties the defaults layer", () => {
    const build = createLoggingBuilder().clearDefaults().build();

    expect(Object.keys(build.defaults)).toEqual([]);
    expect(Object.getPrototypeOf(build.defaults)).toBeNull();
  });

  test("leaves a root the builder sets in place", () => {
    const build = createLoggingBuilder().clearDefaults().addLevels({ "*": "error" }).build();

    expect({ ...build.builder }).toEqual({ "*": "error" });
  });

  test("applies whenever it is called among the sources", () => {
    const build = createLoggingBuilder().addLevels({ a: "info" }).clearDefaults().build();

    expect(Object.keys(build.defaults)).toEqual([]);
    expect({ ...build.builder }).toEqual({ a: "info" });
  });
});

describe("addLevels", () => {
  test("a later source replaces an earlier one's entry for the same category", () => {
    const build = createLoggingBuilder().addLevels({ a: "info", b: "warn" }).addSpec("a:debug").addLevels({ b: "off" }).build();

    expect({ ...build.builder }).toEqual({ a: "debug", b: "off" });
  });

  test("copies the levels when called, so a later change to the argument has no effect", () => {
    const levels: Record<string, Threshold> = { a: "info" };
    const builder = createLoggingBuilder().addLevels(levels);
    levels.a = "trace";
    levels.b = "trace";

    expect({ ...builder.build().builder }).toEqual({ a: "info" });
  });

  test("keeps a __proto__ category from parsed JSON as an own key, never touching a prototype", () => {
    const build = createLoggingBuilder().addLevels(JSON.parse('{"__proto__":"debug"}')).build();

    expect(Object.hasOwn(build.builder, proto)).toBe(true);
    expect(build.builder[proto]).toBe("debug");
    expect(Object.getPrototypeOf(build.builder)).toBeNull();
    expect(({} as Record<string, unknown>).debug).toBeUndefined();
  });

  test("keeps a __proto__ category from a defined property as an own key", () => {
    const levels = {};
    Object.defineProperty(levels, proto, { value: "trace", enumerable: true });
    const build = createLoggingBuilder().addLevels(levels).build();

    expect(build.builder[proto]).toBe("trace");
  });

  test("defers validation to build", () => {
    const builder = createLoggingBuilder();

    expect(() => builder.addLevels({ "a..b": "info" })).not.toThrow();
    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test.for([
    ["an empty category", { "": "info" }],
    ["a category with a colon", { "a:b": "info" }],
    ["a category with a star segment", { "a.*": "info" }],
  ])("build throws a LoggingConfigError for %s", ([, levels]) => {
    expect(() =>
      createLoggingBuilder()
        .addLevels(levels as Record<string, Threshold>)
        .build(),
    ).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test.for(["loud", "WARN", "constructor", proto, null, 3])("build throws a LoggingConfigError for the level %o", (level) => {
    const levels = { a: level } as unknown as Record<string, Threshold>;

    expect(() => createLoggingBuilder().addLevels(levels).build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("build throws for an invalid entry even when a later source replaces it", () => {
    const builder = createLoggingBuilder()
      .addLevels({ a: "loud" as Threshold })
      .addLevels({ a: "info" });

    expect(() => builder.build()).toThrow('Invalid logger level "loud"');
  });

  test.for([null, undefined, "a:info", 5])("build throws a LoggingConfigError for the non-object %o", (levels) => {
    const builder = createLoggingBuilder().addLevels(levels as unknown as Record<string, Threshold>);

    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names the type of a non-object in the message", () => {
    expect(() =>
      createLoggingBuilder()
        .addLevels(null as unknown as Record<string, Threshold>)
        .build(),
    ).toThrow("Invalid logger levels of type null");
    expect(() =>
      createLoggingBuilder()
        .addLevels("x" as unknown as Record<string, Threshold>)
        .build(),
    ).toThrow("Invalid logger levels of type string");
  });
});

describe("addSink", () => {
  test("keeps every sink in the order it was added, the same sink twice included", () => {
    const first = sink();
    const second = sink();

    const build = createLoggingBuilder().addSink(first).addSink(second).addSink(first).build();

    expect(build.sinks).toEqual([
      { sink: first, processors: [] },
      { sink: second, processors: [] },
      { sink: first, processors: [] },
    ]);
    expect(build.sinks[0]?.sink).toBe(first);
    expect(build.sinks[1]?.sink).toBe(second);
    expect(build.sinks[2]?.sink).toBe(first);
  });

  test("registers each sink's processors with it, in order, the registration and its list frozen", () => {
    const first = sink();
    const second = sink();
    const a = processor();
    const b = processor();

    const build = createLoggingBuilder()
      .addSink(first, { processors: [a, b] })
      .addSink(second, {})
      .build();

    expect(build.sinks).toEqual([
      { sink: first, processors: [a, b] },
      { sink: second, processors: [] },
    ]);
    expect(Object.isFrozen(build.sinks[0])).toBe(true);
    expect(Object.isFrozen(build.sinks[0]?.processors)).toBe(true);
  });

  test("copies the processor list when called, so a later change to it has no effect", () => {
    const only = processor();
    const processors = [only];
    const builder = createLoggingBuilder().addSink(sink(), { processors });

    processors.push(processor());

    expect(builder.build().sinks[0]?.processors).toEqual([only]);
  });

  test.for([null, "x", 5, () => {}])("build throws a LoggingConfigError for the non-object options %o", (options) => {
    const builder = createLoggingBuilder().addSink(sink(), options as never);

    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test.for([null, "x", { 0: processor(), length: 1 }, processor()])(
    "build throws a LoggingConfigError for processors %o that are not an array",
    (processors) => {
      const builder = createLoggingBuilder().addSink(sink(), { processors: processors as never });

      expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
    },
  );

  test.for([null, undefined, "x", {}])("build throws a LoggingConfigError for the per-sink processor %o", (value) => {
    const builder = createLoggingBuilder().addSink(sink(), { processors: [processor(), value as never] });

    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names what is wrong in the message", () => {
    expect(() =>
      createLoggingBuilder()
        .addSink(sink(), null as never)
        .build(),
    ).toThrow("Invalid logger sink options of type null: expected an object.");
    expect(() =>
      createLoggingBuilder()
        .addSink(sink(), { processors: "x" as never })
        .build(),
    ).toThrow("Invalid logger sink processors of type string: expected an array.");
    expect(() =>
      createLoggingBuilder()
        .addSink(sink(), { processors: [5 as never] })
        .build(),
    ).toThrow("Invalid logger sink processor of type number: expected a function.");
  });

  test("a build's sink list is unaffected by a later addSink", () => {
    const builder = createLoggingBuilder().addSink(sink());
    const first = builder.build();

    builder.addSink(sink());

    expect(first.sinks).toHaveLength(1);
    expect(builder.build().sinks).toHaveLength(2);
  });

  test("defers validation to build", () => {
    const builder = createLoggingBuilder();

    expect(() => builder.addSink(null as unknown as Sink)).not.toThrow();
    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test.for([null, undefined, "console", 5, () => {}])("build throws a LoggingConfigError for the non-object %o", (value) => {
    const builder = createLoggingBuilder()
      .addSink(sink())
      .addSink(value as unknown as Sink);

    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names the type of a non-object in the message", () => {
    expect(() =>
      createLoggingBuilder()
        .addSink(null as unknown as Sink)
        .build(),
    ).toThrow("Invalid logger sink of type null");
    expect(() =>
      createLoggingBuilder()
        .addSink("x" as unknown as Sink)
        .build(),
    ).toThrow("Invalid logger sink of type string");
  });

  test("an invalid sink is reported before an invalid global processor, whatever the order they were added in", () => {
    const builder = createLoggingBuilder()
      .addProcessor(null as unknown as LogProcessor)
      .addSink(sink(), { processors: "x" as never });

    expect(() => builder.build()).toThrow("Invalid logger sink processors");
  });

  test("an invalid level is reported before an invalid sink, whatever the order they were added in", () => {
    const builder = createLoggingBuilder()
      .addSink(null as unknown as Sink)
      .addLevels({ a: "loud" as Threshold });

    expect(() => builder.build()).toThrow('Invalid logger level "loud"');
  });
});

describe("addProcessor", () => {
  test("keeps every processor in the order it was added, the same processor twice included", () => {
    const first = processor();
    const second = processor();

    const build = createLoggingBuilder().addProcessor(first).addProcessor(second).addProcessor(first).build();

    expect(build.processors).toEqual([first, second, first]);
  });

  test("a build's processor list is unaffected by a later addProcessor", () => {
    const builder = createLoggingBuilder().addProcessor(processor());
    const first = builder.build();

    builder.addProcessor(processor());

    expect(first.processors).toHaveLength(1);
    expect(builder.build().processors).toHaveLength(2);
  });

  test("defers validation to build", () => {
    const builder = createLoggingBuilder();

    expect(() => builder.addProcessor(null as unknown as LogProcessor)).not.toThrow();
    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test.for([null, undefined, "x", 5, {}])("build throws a LoggingConfigError for the non-function %o", (value) => {
    const builder = createLoggingBuilder()
      .addProcessor(processor())
      .addProcessor(value as unknown as LogProcessor);

    expect(() => builder.build()).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names the type of a non-function in the message", () => {
    expect(() =>
      createLoggingBuilder()
        .addProcessor(null as unknown as LogProcessor)
        .build(),
    ).toThrow("Invalid logger processor of type null: expected a function.");
  });
});

describe("clock", () => {
  test("a later call replaces the clock an earlier one set", () => {
    const first = () => 1;
    const second = () => 2;

    expect(createLoggingBuilder().clock(first).build().clock).toBe(first);
    expect(createLoggingBuilder().clock(first).clock(second).build().clock).toBe(second);
  });
});

describe("sample", () => {
  test("validates and freezes each rule, its upTo defaulting to info", () => {
    const build = createLoggingBuilder()
      .sample({ "*": 0.5, db: { rate: 0.1, upTo: "warn" } })
      .build();

    expect({ ...build.policy.sample }).toEqual({ "*": { rate: 0.5, upTo: "info" }, db: { rate: 0.1, upTo: "warn" } });
    expect(Object.isFrozen(build.policy)).toBe(true);
    expect(Object.isFrozen(build.policy.sample)).toBe(true);
    expect(Object.getPrototypeOf(build.policy.sample)).toBeNull();
    expect(Object.isFrozen(build.policy.sample.db)).toBe(true);
  });

  test("a later call's rule for a key replaces an earlier one's and leaves other keys in place", () => {
    const build = createLoggingBuilder().sample({ a: 0.5, b: 0.2 }).sample({ a: 1 }).build();

    expect({ ...build.policy.sample }).toEqual({ a: { rate: 1, upTo: "info" }, b: { rate: 0.2, upTo: "info" } });
  });

  test("copies the rules when called, so a later change to them has no effect", () => {
    const rules: Record<string, number> = { a: 0.5 };
    const builder = createLoggingBuilder().sample(rules);
    rules.a = 0.1;
    rules.b = 0.1;

    expect({ ...builder.build().policy.sample }).toEqual({ a: { rate: 0.5, upTo: "info" } });
  });

  test("keeps a __proto__ category as an own key", () => {
    const rules = Object.defineProperty({}, proto, { value: 0.5, enumerable: true });
    const build = createLoggingBuilder().sample(rules).build();

    expect(Object.hasOwn(build.policy.sample, proto)).toBe(true);
  });

  test.each([
    ["a rate above 1, after a valid rule", { ok: 0.5, a: 1.5 }],
    ["a negative rate", { a: -0.1 }],
    ["a rate that is not a number", { a: "half" }],
    ["an invalid upTo", { a: { rate: 0.5, upTo: "loud" } }],
    ["an invalid category key", { "a..b": 0.5 }],
  ])("throws a LoggingConfigError at the call on %s, leaving the builder unchanged", (_name, rules) => {
    const builder = createLoggingBuilder().sample({ c: 0.5 });

    expect(() => builder.sample(rules as Readonly<Record<string, SampleRule>>)).toThrow(expect.toSatisfy(isLoggingConfigError));
    expect({ ...builder.build().policy.sample }).toEqual({ c: { rate: 0.5, upTo: "info" } });
  });

  test("throws a LoggingConfigError at the call on an argument that is not an object", () => {
    expect(() => createLoggingBuilder().sample(null as unknown as Readonly<Record<string, SampleRule>>)).toThrow(
      expect.toSatisfy(isLoggingConfigError),
    );
  });
});

describe("rateLimit", () => {
  test("validates and freezes each rule, its upTo defaulting to info, and keeps a clearing false", () => {
    const build = createLoggingBuilder()
      .rateLimit({ "*": { burst: 20, perMinute: 60 }, db: { burst: 5, perMinute: 1, upTo: "error" }, "db.pool": false })
      .build();

    expect({ ...build.policy.rateLimit }).toEqual({
      "*": { burst: 20, perMinute: 60, upTo: "info" },
      db: { burst: 5, perMinute: 1, upTo: "error" },
      "db.pool": false,
    });
    expect(Object.isFrozen(build.policy.rateLimit)).toBe(true);
    expect(Object.getPrototypeOf(build.policy.rateLimit)).toBeNull();
    expect(Object.isFrozen(build.policy.rateLimit.db)).toBe(true);
  });

  test("a later call's rule for a key replaces an earlier one's and leaves other keys in place", () => {
    const build = createLoggingBuilder()
      .rateLimit({ a: { burst: 1, perMinute: 1 }, b: { burst: 2, perMinute: 2 } })
      .rateLimit({ a: false })
      .build();

    expect({ ...build.policy.rateLimit }).toEqual({ a: false, b: { burst: 2, perMinute: 2, upTo: "info" } });
  });

  test("is independent of the sampling rules", () => {
    const build = createLoggingBuilder()
      .sample({ a: 0.5 })
      .rateLimit({ b: { burst: 1, perMinute: 1 } })
      .build();

    expect(Object.keys(build.policy.sample)).toEqual(["a"]);
    expect(Object.keys(build.policy.rateLimit)).toEqual(["b"]);
  });

  test.each([
    ["a burst below 1", { a: { burst: 0, perMinute: 1 } }],
    ["a perMinute of 0", { a: { burst: 1, perMinute: 0 } }],
    ["an infinite burst", { a: { burst: Number.POSITIVE_INFINITY, perMinute: 1 } }],
    ["true", { a: true }],
    ["an invalid upTo", { a: { burst: 1, perMinute: 1, upTo: "loud" } }],
    ["an invalid category key", { ".a": { burst: 1, perMinute: 1 } }],
  ])("throws a LoggingConfigError at the call on %s, leaving the builder unchanged", (_name, rules) => {
    const builder = createLoggingBuilder().rateLimit({ c: false });

    expect(() => builder.rateLimit(rules as Readonly<Record<string, RateLimitRule>>)).toThrow(expect.toSatisfy(isLoggingConfigError));
    expect({ ...builder.build().policy.rateLimit }).toEqual({ c: false });
  });

  test("throws a LoggingConfigError at the call on an argument that is not an object", () => {
    expect(() => createLoggingBuilder().rateLimit("a" as unknown as Readonly<Record<string, RateLimitRule>>)).toThrow(
      expect.toSatisfy(isLoggingConfigError),
    );
  });
});

describe("random", () => {
  test("defaults to Math.random, and a later call replaces an earlier one", () => {
    const first = () => 0.25;
    const second = () => 0.75;

    expect(createLoggingBuilder().build().random).toBe(Math.random);
    expect(createLoggingBuilder().random(first).build().random).toBe(first);
    expect(createLoggingBuilder().random(first).random(second).build().random).toBe(second);
  });
});

describe("redaction", () => {
  test("replaces the default policy", () => {
    const policy = composePolicies(secretKeys, { keys: ["ssn"] });

    expect(createLoggingBuilder().redaction(policy).build().redaction).toBe(policy);
  });

  test("null disables redaction", () => {
    expect(createLoggingBuilder().redaction(null).build().redaction).toBeNull();
  });

  test("a later call replaces the setting an earlier one made", () => {
    const policy = { keys: ["ssn"] };

    expect(createLoggingBuilder().redaction(null).redaction(policy).build().redaction).toBe(policy);
    expect(createLoggingBuilder().redaction(policy).redaction(null).build().redaction).toBeNull();
  });
});

describe("addSpec", () => {
  test("adds the spec's entries as a source", () => {
    const build = createLoggingBuilder().addSpec("*:info, react:debug").build();

    expect({ ...build.builder }).toEqual({ "*": "info", react: "debug" });
  });

  test("skips bad entries without throwing and carries every issue forward in order", () => {
    const build = createLoggingBuilder().addSpec("a:info,bad,b:loud").addLevels({ c: "warn" }).addSpec("c:x,a:info,a:error").build();

    expect({ ...build.builder }).toEqual({ a: "error", c: "warn" });
    expect(build.issues).toHaveLength(4);
    expect(build.issues[0]).toContain('"bad"');
    expect(build.issues[1]).toContain('"b:loud"');
    expect(build.issues[2]).toContain('"c:x"');
    expect(build.issues[3]).toContain('"a:error"');
  });

  test("carries a non-string spec forward as an issue", () => {
    const build = createLoggingBuilder()
      .addSpec(undefined as unknown as string)
      .build();

    expect(Object.keys(build.builder)).toEqual([]);
    expect(build.issues).toHaveLength(1);
  });

  test("keeps a __proto__ category as an own key", () => {
    const build = createLoggingBuilder().addSpec("__proto__:off").build();

    expect(Object.hasOwn(build.builder, proto)).toBe(true);
    expect(build.builder[proto]).toBe("off");
  });
});

describe("build", () => {
  test("gives an equal result when called again, and a build is unaffected by later additions", () => {
    const builder = createLoggingBuilder().addLevels({ a: "info" }).addSpec("bad");
    const first = builder.build();

    expect(builder.build()).toEqual(first);

    builder.addLevels({ a: "error" }).addSpec("worse").clearDefaults();

    expect({ ...first.builder }).toEqual({ a: "info" });
    expect({ ...first.defaults }).toEqual({ "*": "warn" });
    expect(first.issues).toHaveLength(1);
  });

  test("feeds a settings snapshot, the builder layer above the defaults", () => {
    const { defaults, builder } = createLoggingBuilder().addLevels({ "*": "error", a: "debug" }).build();
    const settings = createSettings({ defaults, builder, overrides: {}, environment: {} });

    expect(settings.levels["*"]?.level).toBe("error");
    expect(settings.levels.a?.level).toBe("debug");
  });

  test("feeds a settings snapshot its sinks, processors, clock and redaction", () => {
    const only = sink();
    const perSink = processor();
    const global = processor();
    const clock = () => 7;
    const build = createLoggingBuilder()
      .addSink(only, { processors: [perSink] })
      .addProcessor(global)
      .clock(clock)
      .redaction(null)
      .build();
    const settings = createSettings({ defaults: build.defaults, builder: build.builder, overrides: {}, environment: {} }, build);

    expect(settings.sinks).toEqual([{ sink: only, processors: [perSink] }]);
    expect(settings.processors).toEqual([global]);
    expect(settings.clock).toBe(clock);
    expect(settings.redaction).toBeNull();
  });

  test("feeds a settings snapshot its policy layer and random source", () => {
    const random = () => 0.5;
    const build = createLoggingBuilder()
      .sample({ a: 0.5 })
      .rateLimit({ b: { burst: 1, perMinute: 1 } })
      .random(random)
      .build();
    const settings = createSettings({ defaults: build.defaults, builder: build.builder, overrides: {}, environment: {} }, build, {
      defaults: {},
      builder: build.policy,
      overrides: {},
      environment: {},
    });

    expect({ ...settings.policy.sample }).toEqual({ a: { rate: 0.5, upTo: "info" } });
    expect(settings.policy.rateLimit.b).toMatchObject({ burst: 1, perMinute: 1, upTo: "info" });
    expect(settings.random).toBe(random);
  });
});
