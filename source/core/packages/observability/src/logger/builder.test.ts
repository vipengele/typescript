import { systemClock, type Threshold } from "@vipengele/ts-core-common";
import { composePolicies, secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test } from "vitest";
import { createLoggingBuilder } from "./builder";
import { isLoggingConfigError } from "./config-error";
import type { Sink } from "./record";
import { createSettings } from "./settings";

const proto = "__proto__";

function sink(): Sink {
  return { write: () => {} };
}

describe("createLoggingBuilder", () => {
  test("builds the defaults alone when nothing is added", () => {
    const build = createLoggingBuilder().build();

    expect({ ...build.defaults }).toEqual({ "*": "warn" });
    expect(Object.keys(build.builder)).toEqual([]);
    expect(build.sinks).toEqual([]);
    expect(build.clock).toBe(systemClock);
    expect(build.redaction).toBe(secretKeys);
    expect(build.issues).toEqual([]);
  });

  test("every method but build returns the builder, so calls chain", () => {
    const builder = createLoggingBuilder();

    expect(builder.clearDefaults()).toBe(builder);
    expect(builder.addLevels({ a: "info" })).toBe(builder);
    expect(builder.addSpec("b:debug")).toBe(builder);
    expect(builder.addSink(sink())).toBe(builder);
    expect(builder.clock(() => 0)).toBe(builder);
    expect(builder.redaction(null)).toBe(builder);
    expect({ ...builder.build().builder }).toEqual({ a: "info", b: "debug" });
  });

  test("returns frozen, prototype-less layers and frozen issues", () => {
    const build = createLoggingBuilder().addLevels({ a: "info" }).addSpec("bad").build();

    expect(Object.isFrozen(build)).toBe(true);
    expect(Object.isFrozen(build.builder)).toBe(true);
    expect(Object.getPrototypeOf(build.builder)).toBeNull();
    expect(Object.isFrozen(build.issues)).toBe(true);
    expect(Object.isFrozen(build.sinks)).toBe(true);
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

    expect(build.sinks).toHaveLength(3);
    expect(build.sinks[0]).toBe(first);
    expect(build.sinks[1]).toBe(second);
    expect(build.sinks[2]).toBe(first);
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

  test("an invalid level is reported before an invalid sink, whatever the order they were added in", () => {
    const builder = createLoggingBuilder()
      .addSink(null as unknown as Sink)
      .addLevels({ a: "loud" as Threshold });

    expect(() => builder.build()).toThrow('Invalid logger level "loud"');
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
    const settings = createSettings({ defaults, builder, overrides: {} });

    expect(settings.levels["*"]?.level).toBe("error");
    expect(settings.levels.a?.level).toBe("debug");
  });

  test("feeds a settings snapshot its sinks, clock and redaction", () => {
    const only = sink();
    const clock = () => 7;
    const build = createLoggingBuilder().addSink(only).clock(clock).redaction(null).build();
    const settings = createSettings({ defaults: build.defaults, builder: build.builder, overrides: {} }, build);

    expect(settings.sinks).toEqual([only]);
    expect(settings.clock).toBe(clock);
    expect(settings.redaction).toBeNull();
  });
});
