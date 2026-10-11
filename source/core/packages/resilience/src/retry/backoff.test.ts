import { describe, expect, test, vi } from "vitest";
import { isResilienceConfigError } from "../errors";
import { exponentialBackoff, fixedBackoff, type JitterKind, withJitter } from "./index";

function configErrorOf(build: () => unknown): unknown {
  try {
    build();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

const invalid = [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("fixedBackoff", () => {
  test("returns the same delay for every attempt", () => {
    const backoff = fixedBackoff(250);

    expect([1, 2, 3, 10].map(backoff)).toEqual([250, 250, 250, 250]);
  });

  test("accepts 0 and a fractional delay", () => {
    expect(fixedBackoff(0)(1)).toBe(0);
    expect(fixedBackoff(0.5)(1)).toBe(0.5);
  });

  test.each(invalid)("rejects %s with a ResilienceConfigError", (ms) => {
    expect(isResilienceConfigError(configErrorOf(() => fixedBackoff(ms)))).toBe(true);
  });
});

describe("exponentialBackoff", () => {
  test("doubles from initialMs by default", () => {
    const backoff = exponentialBackoff({ initialMs: 100 });

    expect([1, 2, 3, 4].map(backoff)).toEqual([100, 200, 400, 800]);
  });

  test("uses the given multiplier", () => {
    const backoff = exponentialBackoff({ initialMs: 10, multiplier: 3 });

    expect([1, 2, 3].map(backoff)).toEqual([10, 30, 90]);
  });

  test("a multiplier of 1 keeps the delay constant", () => {
    expect([1, 2, 3].map(exponentialBackoff({ initialMs: 40, multiplier: 1 }))).toEqual([40, 40, 40]);
  });

  test("caps every delay at maxMs", () => {
    const backoff = exponentialBackoff({ initialMs: 100, maxMs: 300 });

    expect([1, 2, 3, 4].map(backoff)).toEqual([100, 200, 300, 300]);
  });

  test("an uncapped delay grows without bound", () => {
    expect(exponentialBackoff({ initialMs: 1 })(2000)).toBe(Number.POSITIVE_INFINITY);
  });

  test("accepts 0 for initialMs and maxMs", () => {
    expect(exponentialBackoff({ initialMs: 0 })(3)).toBe(0);
    expect(exponentialBackoff({ initialMs: 10, maxMs: 0 })(3)).toBe(0);
  });

  test.each(invalid)("rejects initialMs %s with a ResilienceConfigError", (initialMs) => {
    expect(isResilienceConfigError(configErrorOf(() => exponentialBackoff({ initialMs })))).toBe(true);
  });

  test.each(invalid)("rejects maxMs %s with a ResilienceConfigError", (maxMs) => {
    expect(isResilienceConfigError(configErrorOf(() => exponentialBackoff({ initialMs: 1, maxMs })))).toBe(true);
  });

  test.each([0.5, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])("rejects multiplier %s with a ResilienceConfigError", (multiplier) => {
    expect(isResilienceConfigError(configErrorOf(() => exponentialBackoff({ initialMs: 1, multiplier })))).toBe(true);
  });
});

describe("withJitter", () => {
  test('"full" scales the whole delay by the random draw', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.25).mockReturnValueOnce(0.999);
    const backoff = withJitter(fixedBackoff(400), "full", random);

    expect([1, 2, 3].map(backoff)).toEqual([0, 100, 399.6]);
    expect(random).toHaveBeenCalledTimes(3);
  });

  test('"equal" keeps half the delay and scales the other half', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.75);
    const backoff = withJitter(fixedBackoff(400), "equal", random);

    expect([1, 2, 3].map(backoff)).toEqual([200, 300, 350]);
  });

  test("passes the attempt to the wrapped strategy", () => {
    const backoff = withJitter(exponentialBackoff({ initialMs: 100 }), "equal", () => 0);

    expect([1, 2, 3].map(backoff)).toEqual([50, 100, 200]);
  });

  test("defaults to Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(withJitter(fixedBackoff(100), "full")(1)).toBe(50);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  test("rejects an unknown kind with a ResilienceConfigError", () => {
    expect(isResilienceConfigError(configErrorOf(() => withJitter(fixedBackoff(1), "half" as JitterKind)))).toBe(true);
  });
});
