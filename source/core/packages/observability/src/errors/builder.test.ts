import { systemClock } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, it } from "vitest";
import { ReporterBuilder } from "./builder";
import type { ErrorEvent } from "./event";
import type { Integration } from "./integration";
import { isReporterConfigError } from "./reporter-config-error";

/** `[<hole>, "production"]`: an array whose first index holds nothing at all. */
function sparse(): string[] {
  const environments: string[] = [];
  environments[1] = "production";
  return environments;
}

function anIntegration(name: string): Integration {
  return { name, setup: () => undefined };
}

describe("ReporterBuilder", () => {
  it("starts with no transport, the system clock, no integrations, the secretKeys redaction, no limits, no enabled environments, no processors, no beforeSend, a sample rate of 1 drawn with Math.random, no ignored errors, deduplication on and a rate limit of 60 refilled at 60 per minute", () => {
    const settings = new ReporterBuilder().build();

    expect(settings).toEqual({
      transport: undefined,
      clock: systemClock,
      integrations: [],
      redaction: secretKeys,
      limits: {},
      enabledEnvironments: undefined,
      processors: [],
      beforeSend: undefined,
      sampleRate: 1,
      random: Math.random,
      ignoreErrors: [],
      dedupe: true,
      rateLimit: { burst: 60, perMinute: 60 },
    });
    expect(settings).toHaveProperty("enabledEnvironments", undefined);
    expect(settings).toHaveProperty("beforeSend", undefined);
    expect(Object.isFrozen(settings.processors)).toBe(true);
    expect(Object.isFrozen(settings.ignoreErrors)).toBe(true);
    expect(Object.isFrozen(settings.rateLimit)).toBe(true);
  });

  it("keeps the redaction set last, null included", () => {
    const builder = new ReporterBuilder();
    const policy = { keys: ["region"] };

    expect(builder.redaction(policy)).toBe(builder);
    expect(builder.build().redaction).toBe(policy);
    expect(builder.redaction(null).build().redaction).toBeNull();
  });

  it("keeps integrations in the order they were added", () => {
    const first = anIntegration("first");
    const second = anIntegration("second");

    expect(new ReporterBuilder().add(first).add(second).build().integrations).toEqual([first, second]);
  });

  it("replaces an integration with a later one of the same name, in its place", () => {
    const replaced = anIntegration("handlers");
    const other = anIntegration("other");
    const current = anIntegration("handlers");

    const { integrations } = new ReporterBuilder().add(replaced).add(other).add(current).build();

    expect(integrations).toHaveLength(2);
    expect(integrations[0]).toBe(current);
    expect(integrations[1]).toBe(other);
  });

  it("has no project root until one is set", () => {
    expect(new ReporterBuilder().build().projectRoot).toBeUndefined();
  });

  it("keeps the project root set last", () => {
    const builder = new ReporterBuilder();

    expect(builder.projectRoot("/first")).toBe(builder);
    builder.projectRoot("/app");

    expect(builder.build().projectRoot).toBe("/app");
  });

  it("builds a snapshot a later add does not change", () => {
    const builder = new ReporterBuilder().add(anIntegration("first"));
    const settings = builder.build();

    builder.add(anIntegration("second"));

    expect(settings.integrations).toHaveLength(1);
  });

  describe("limits", () => {
    it("keeps every option set, and returns the builder", () => {
      const builder = new ReporterBuilder();
      const limits = { maxDepth: 3, maxBreadth: 10, maxStringLength: 256, maxLinks: 2, maxErrors: Number.POSITIVE_INFINITY };

      expect(builder.limits(limits)).toBe(builder);
      expect(builder.build().limits).toEqual(limits);
    });

    it("merges a later call over an earlier one, option by option", () => {
      const { limits } = new ReporterBuilder().limits({ maxDepth: 3, maxLinks: 2 }).limits({ maxLinks: 7, maxErrors: 4 }).build();

      expect(limits).toEqual({ maxDepth: 3, maxLinks: 7, maxErrors: 4 });
    });

    it("keeps an earlier option a later call leaves undefined", () => {
      const { limits } = new ReporterBuilder().limits({ maxDepth: 3 }).limits({ maxDepth: undefined }).build();

      expect(limits).toEqual({ maxDepth: 3 });
    });

    it("ignores keys that are not limits", () => {
      const { limits } = new ReporterBuilder().limits({ maxDepth: 2, other: 0 } as never).build();

      expect(limits).toEqual({ maxDepth: 2 });
    });

    it("builds a frozen snapshot a later call does not change", () => {
      const builder = new ReporterBuilder().limits({ maxDepth: 3 });
      const { limits } = builder.build();

      builder.limits({ maxDepth: 4 });

      expect(Object.isFrozen(limits)).toBe(true);
      expect(limits).toEqual({ maxDepth: 3 });
    });

    it.for([
      ["NaN", Number.NaN],
      ["zero", 0],
      ["a negative integer", -1],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["a fraction", 1.5],
      ["a numeric string", "5"],
      ["null", null],
      ["a bigint", 5n],
    ] as const)("rejects %s", ([, value]) => {
      expect(() => new ReporterBuilder().limits({ maxBreadth: value as never })).toThrow(expect.toSatisfy(isReporterConfigError));
    });

    it("names the option and the value it rejects", () => {
      expect(() => new ReporterBuilder().limits({ maxLinks: -2 })).toThrow(
        "Invalid reporter limit maxLinks -2: expected a positive integer or Infinity.",
      );
      expect(() => new ReporterBuilder().limits({ maxErrors: "3" as never })).toThrow(
        "Invalid reporter limit maxErrors of type string: expected a positive integer or Infinity.",
      );
      expect(() => new ReporterBuilder().limits({ maxDepth: null as never })).toThrow(
        "Invalid reporter limit maxDepth of type null: expected a positive integer or Infinity.",
      );
    });

    it.for([null, undefined, 5, "limits"])("rejects %o in place of an object", (value) => {
      expect(() => new ReporterBuilder().limits(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
    });

    it("leaves the builder unchanged when any option is rejected", () => {
      const builder = new ReporterBuilder().limits({ maxDepth: 3 });

      expect(() => builder.limits({ maxDepth: 9, maxBreadth: 9, maxErrors: 0 })).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().limits).toEqual({ maxDepth: 3 });
    });
  });

  describe("enabledEnvironments", () => {
    it("keeps the list set, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.enabledEnvironments(["production", "staging"])).toBe(builder);
      expect(builder.build().enabledEnvironments).toEqual(["production", "staging"]);
    });

    it("keeps the empty string as an environment of its own", () => {
      expect(new ReporterBuilder().enabledEnvironments([""]).build().enabledEnvironments).toEqual([""]);
    });

    it("replaces an earlier list with a later one", () => {
      const { enabledEnvironments } = new ReporterBuilder().enabledEnvironments(["production"]).enabledEnvironments(["staging"]).build();

      expect(enabledEnvironments).toEqual(["staging"]);
    });

    it("builds a frozen copy a later change to the caller's array does not reach", () => {
      const environments = ["production"];
      const builder = new ReporterBuilder().enabledEnvironments(environments);

      environments.push("staging");
      environments[0] = "development";
      const { enabledEnvironments } = builder.build();

      expect(enabledEnvironments).toEqual(["production"]);
      expect(enabledEnvironments).not.toBe(environments);
      expect(Object.isFrozen(enabledEnvironments)).toBe(true);
    });

    it.for([
      ["an empty list", []],
      ["a number entry", ["production", 5]],
      ["an undefined entry", [undefined]],
      ["a null entry", ["production", null]],
      ["a hole", sparse()],
      ["an object entry", [{ toString: (): string => "production" }]],
    ] as const)("rejects %s", ([, value]) => {
      expect(() => new ReporterBuilder().enabledEnvironments(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
    });

    it.for([null, undefined, "production", { 0: "production", length: 1 }])("rejects %o in place of an array", (value) => {
      expect(() => new ReporterBuilder().enabledEnvironments(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().enabledEnvironments([])).toThrow(
        "Invalid reporter enabled environments: expected at least one environment.",
      );
      expect(() => new ReporterBuilder().enabledEnvironments(["production", 7 as never])).toThrow(
        "Invalid reporter enabled environment at index 1 7: expected a string.",
      );
      expect(() => new ReporterBuilder().enabledEnvironments(null as never)).toThrow(
        "Invalid reporter enabled environments of type null: expected an array of strings.",
      );
    });

    it("leaves the builder unchanged when the list is rejected, and still takes a valid one afterwards", () => {
      const builder = new ReporterBuilder().enabledEnvironments(["production"]);

      expect(() => builder.enabledEnvironments([])).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(() => builder.enabledEnvironments(["staging", 1 as never])).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().enabledEnvironments).toEqual(["production"]);

      expect(builder.enabledEnvironments(["staging"]).build().enabledEnvironments).toEqual(["staging"]);
    });

    it("leaves an unset list unset when the first call is rejected", () => {
      const builder = new ReporterBuilder();

      expect(() => builder.enabledEnvironments([])).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().enabledEnvironments).toBeUndefined();
    });
  });

  describe("addProcessor", () => {
    const first = (event: ErrorEvent): ErrorEvent => event;
    const second = (): null => null;

    it("keeps processors in the order added, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.addProcessor(first)).toBe(builder);
      builder.addProcessor(second).addProcessor(first);

      expect(builder.build().processors).toEqual([first, second, first]);
    });

    it("builds a frozen snapshot a later addProcessor does not change", () => {
      const builder = new ReporterBuilder().addProcessor(first);
      const { processors } = builder.build();

      builder.addProcessor(second);

      expect(processors).toEqual([first]);
      expect(Object.isFrozen(processors)).toBe(true);
      expect(builder.build().processors).toEqual([first, second]);
    });

    it.for([null, undefined, 5, "processor", {}])("rejects %o and leaves the builder as it was", (value) => {
      const builder = new ReporterBuilder().addProcessor(first);

      expect(() => builder.addProcessor(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().processors).toEqual([first]);
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().addProcessor(null as never)).toThrow(
        "Invalid reporter processor of type null: expected a function.",
      );
      expect(() => new ReporterBuilder().addProcessor(5 as never)).toThrow("Invalid reporter processor 5: expected a function.");
    });
  });

  describe("beforeSend", () => {
    const first = (event: ErrorEvent): ErrorEvent => event;
    const last = (): null => null;

    it("keeps the hook set last, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.beforeSend(first)).toBe(builder);
      expect(builder.build().beforeSend).toBe(first);
      expect(builder.beforeSend(last).build().beforeSend).toBe(last);
    });

    it.for([null, undefined, 5, "hook", {}])("rejects %o and leaves the builder as it was", (value) => {
      const builder = new ReporterBuilder().beforeSend(first);

      expect(() => builder.beforeSend(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().beforeSend).toBe(first);
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().beforeSend("hook" as never)).toThrow(
        "Invalid reporter beforeSend hook of type string: expected a function.",
      );
    });
  });

  describe("random", () => {
    it("keeps the source set last, and returns the builder", () => {
      const builder = new ReporterBuilder();
      const first = (): number => 0.1;
      const last = (): number => 0.9;

      expect(builder.random(first)).toBe(builder);
      expect(builder.build().random).toBe(first);
      expect(builder.random(last).build().random).toBe(last);
    });
  });

  describe("sampleRate", () => {
    it("keeps the rate set last, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.sampleRate(0.25)).toBe(builder);
      expect(builder.build().sampleRate).toBe(0.25);
      expect(builder.sampleRate(0.5).build().sampleRate).toBe(0.5);
    });

    it.for([0, 1, 0.5])("accepts %d", (rate) => {
      expect(new ReporterBuilder().sampleRate(rate).build().sampleRate).toBe(rate);
    });

    it.for([
      ["NaN", Number.NaN],
      ["a negative number", -0.1],
      ["a number above 1", 1.01],
      ["infinity", Number.POSITIVE_INFINITY],
      ["a numeric string", "0.5"],
      ["null", null],
      ["undefined", undefined],
      ["a bigint", 1n],
    ] as const)("rejects %s and leaves the builder as it was", ([, value]) => {
      const builder = new ReporterBuilder().sampleRate(0.3);

      expect(() => builder.sampleRate(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().sampleRate).toBe(0.3);
    });

    it("names the value it rejects", () => {
      expect(() => new ReporterBuilder().sampleRate(2)).toThrow("Invalid reporter sample rate 2: expected a number from 0 to 1.");
      expect(() => new ReporterBuilder().sampleRate(Number.NaN)).toThrow(
        "Invalid reporter sample rate NaN: expected a number from 0 to 1.",
      );
      expect(() => new ReporterBuilder().sampleRate("1" as never)).toThrow(
        "Invalid reporter sample rate of type string: expected a number from 0 to 1.",
      );
    });
  });

  describe("ignoreErrors", () => {
    it("keeps the patterns set, and returns the builder", () => {
      const builder = new ReporterBuilder();
      const pattern = /^Timeout/;

      expect(builder.ignoreErrors(["ResizeObserver", pattern])).toBe(builder);
      expect(builder.build().ignoreErrors).toEqual(["ResizeObserver", pattern]);
      expect(builder.build().ignoreErrors[1]).toBe(pattern);
    });

    it("replaces an earlier list with a later one, the empty list included", () => {
      const builder = new ReporterBuilder().ignoreErrors(["first"]).ignoreErrors(["second"]);

      expect(builder.build().ignoreErrors).toEqual(["second"]);
      expect(builder.ignoreErrors([]).build().ignoreErrors).toEqual([]);
    });

    it("builds a frozen copy a later change to the caller's array does not reach", () => {
      const patterns: (string | RegExp)[] = ["first"];
      const builder = new ReporterBuilder().ignoreErrors(patterns);

      patterns.push("second");
      patterns[0] = "changed";
      const { ignoreErrors } = builder.build();

      expect(ignoreErrors).toEqual(["first"]);
      expect(ignoreErrors).not.toBe(patterns);
      expect(Object.isFrozen(ignoreErrors)).toBe(true);
    });

    it.for([
      ["a number entry", ["first", 5]],
      ["an undefined entry", [undefined]],
      ["a null entry", [null]],
      ["a hole", sparse()],
      ["a function entry", [() => true]],
      ["an object entry", [{ test: () => true }]],
    ] as const)("rejects %s and leaves the builder as it was", ([, value]) => {
      const builder = new ReporterBuilder().ignoreErrors(["kept"]);

      expect(() => builder.ignoreErrors(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().ignoreErrors).toEqual(["kept"]);
    });

    it.for([null, undefined, "pattern", /pattern/, { 0: "pattern", length: 1 }])("rejects %o in place of an array", (value) => {
      const builder = new ReporterBuilder().ignoreErrors(["kept"]);

      expect(() => builder.ignoreErrors(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().ignoreErrors).toEqual(["kept"]);
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().ignoreErrors(["first", 7 as never])).toThrow(
        "Invalid reporter ignoreErrors pattern at index 1 7: expected a string or a RegExp.",
      );
      expect(() => new ReporterBuilder().ignoreErrors(null as never)).toThrow(
        "Invalid reporter ignoreErrors of type null: expected an array of strings and RegExps.",
      );
    });
  });

  describe("dedupe", () => {
    it("keeps the setting made last, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.dedupe(false)).toBe(builder);
      expect(builder.build().dedupe).toBe(false);
      expect(builder.dedupe(true).build().dedupe).toBe(true);
    });

    it.for([
      ["a string", "false"],
      ["a number", 0],
      ["null", null],
      ["undefined", undefined],
      ["an object", {}],
    ] as const)("rejects %s and leaves the builder as it was", ([, value]) => {
      const builder = new ReporterBuilder().dedupe(false);

      expect(() => builder.dedupe(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().dedupe).toBe(false);
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().dedupe(0 as never)).toThrow("Invalid reporter dedupe 0: expected a boolean.");
      expect(() => new ReporterBuilder().dedupe("no" as never)).toThrow("Invalid reporter dedupe of type string: expected a boolean.");
    });
  });

  describe("rateLimit", () => {
    it("keeps the setting made last, false included, and returns the builder", () => {
      const builder = new ReporterBuilder();

      expect(builder.rateLimit({ burst: 5, perMinute: 2 })).toBe(builder);
      expect(builder.build().rateLimit).toEqual({ burst: 5, perMinute: 2 });
      expect(builder.rateLimit(false).build().rateLimit).toBe(false);
      expect(builder.rateLimit({ burst: 1, perMinute: 0.5 }).build().rateLimit).toEqual({ burst: 1, perMinute: 0.5 });
    });

    it("builds a frozen copy holding only burst and perMinute, which a later change to the caller's object does not reach", () => {
      const limit = { burst: 5, perMinute: 2, extra: true };
      const builder = new ReporterBuilder().rateLimit(limit);

      limit.burst = 100;
      const { rateLimit } = builder.build();

      expect(rateLimit).toEqual({ burst: 5, perMinute: 2 });
      expect(Object.isFrozen(rateLimit)).toBe(true);
    });

    it.for([
      ["true", true],
      ["null", null],
      ["undefined", undefined],
      ["a number", 60],
      ["an object without burst", { perMinute: 60 }],
      ["an object without perMinute", { burst: 60 }],
      ["a zero burst", { burst: 0, perMinute: 60 }],
      ["a negative perMinute", { burst: 60, perMinute: -1 }],
      ["an infinite burst", { burst: Number.POSITIVE_INFINITY, perMinute: 60 }],
      ["a NaN perMinute", { burst: 60, perMinute: Number.NaN }],
      ["a numeric string burst", { burst: "60", perMinute: 60 }],
    ] as const)("rejects %s and leaves the builder as it was", ([, value]) => {
      const builder = new ReporterBuilder().rateLimit({ burst: 3, perMinute: 4 });

      expect(() => builder.rateLimit(value as never)).toThrow(expect.toSatisfy(isReporterConfigError));
      expect(builder.build().rateLimit).toEqual({ burst: 3, perMinute: 4 });
    });

    it("names what it rejects", () => {
      expect(() => new ReporterBuilder().rateLimit(true as never)).toThrow(
        "Invalid reporter rate limit of type boolean: expected false or an object.",
      );
      expect(() => new ReporterBuilder().rateLimit({ burst: 0, perMinute: 60 })).toThrow(
        "Invalid reporter rate limit burst 0: expected a positive finite number.",
      );
      expect(() => new ReporterBuilder().rateLimit({ burst: 60 } as never)).toThrow(
        "Invalid reporter rate limit perMinute of type undefined: expected a positive finite number.",
      );
    });
  });
});
