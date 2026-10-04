import { Scope } from "@vipengele/ts-core-common/scope";
import { describe, expect, it } from "vitest";
import { createReporter } from "./reporter";
import { createTestTransport } from "./transports/test-transport";

/** Yields to the macrotask queue, a boundary every carrier that survives an await must cross. */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("scope attributes in an event across awaits", () => {
  it("keeps each concurrent isolated scope's attributes after interleaved awaits", async () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) => b.transport(transport));

    const request = async (name: string): Promise<void> => {
      await Scope.isolated("request", { request: name }, async () => {
        await nextTick();
        reporter.captureException(new Error(name), { attributes: { name } });
        await nextTick();
        reporter.captureException(new Error(name), { attributes: { name, second: true } });
      });
    };

    await Promise.all([request("a"), request("b")]);

    for (const name of ["a", "b"]) {
      const own = transport.events.filter((event) => event.exception?.message === name);
      expect(own).toHaveLength(2);
      for (const event of own) {
        expect(event.attributes.request).toBe(name);
      }
    }
  });
});
