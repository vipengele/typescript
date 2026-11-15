import { describe, expect, test } from "vitest";
import { isHttpConfigError } from "./errors/http-errors";
import { filter, Order } from "./filter";

const handle = async () => new Response("ok");

describe("Order", () => {
  test("places the built-in filters from outermost to innermost", () => {
    expect(Order).toEqual({
      OBSERVABILITY: 100,
      AUTH: 200,
      RETRY: 1000,
      CIRCUIT_BREAKER: 1100,
      RATE_LIMITER: 1200,
      TIMEOUT: 1300,
      BULKHEAD: 1400,
      ATTEMPT: 2000,
    });
  });

  test("is frozen", () => {
    expect(Object.isFrozen(Order)).toBe(true);
  });
});

describe("filter", () => {
  test("builds a frozen filter from its parts", () => {
    const built = filter({ name: "auth", order: Order.AUTH, handle });

    expect(built).toEqual({ name: "auth", order: 200, allowsOrderTie: false, handle });
    expect(Object.isFrozen(built)).toBe(true);
  });

  test("keeps allowsOrderTie when set", () => {
    expect(filter({ name: "tag", order: 5, allowsOrderTie: true, handle }).allowsOrderTie).toBe(true);
  });

  test.each([
    ["an empty name", ""],
    ["a blank name", "  "],
    ["a non-string name", 42 as unknown as string],
  ])("rejects %s", (_, name) => {
    let thrown: unknown;
    try {
      filter({ name, order: 1, handle });
    } catch (error) {
      thrown = error;
    }
    expect(isHttpConfigError(thrown)).toBe(true);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "1" as unknown as number],
  ])("rejects an order of %s, naming the filter", (_, order) => {
    expect(() => filter({ name: "auth", order, handle })).toThrow(/"auth"/);
    let thrown: unknown;
    try {
      filter({ name: "auth", order, handle });
    } catch (error) {
      thrown = error;
    }
    expect(isHttpConfigError(thrown)).toBe(true);
  });
});
