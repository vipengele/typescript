import { systemClock } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, it } from "vitest";
import { ReporterBuilder } from "./builder";
import type { Integration } from "./integration";
import { isReporterConfigError } from "./reporter-config-error";

function anIntegration(name: string): Integration {
  return { name, setup: () => undefined };
}

describe("ReporterBuilder", () => {
  it("starts with no transport, the system clock, no integrations, the secretKeys redaction and no limits", () => {
    expect(new ReporterBuilder().build()).toEqual({
      transport: undefined,
      clock: systemClock,
      integrations: [],
      redaction: secretKeys,
      limits: {},
    });
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
});
