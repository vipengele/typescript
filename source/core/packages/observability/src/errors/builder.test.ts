import { systemClock } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, it } from "vitest";
import { ReporterBuilder } from "./builder";
import type { Integration } from "./integration";

function anIntegration(name: string): Integration {
  return { name, setup: () => undefined };
}

describe("ReporterBuilder", () => {
  it("starts with no transport, the system clock, no integrations and the secretKeys redaction", () => {
    expect(new ReporterBuilder().build()).toEqual({ transport: undefined, clock: systemClock, integrations: [], redaction: secretKeys });
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
});
