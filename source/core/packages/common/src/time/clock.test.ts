import { expect, test } from "vitest";
import { systemClock } from "./clock";

test("systemClock reads epoch milliseconds close to Date.now()", () => {
  const before = Date.now();
  const now = systemClock();
  const after = Date.now();

  expect(now).toBeTypeOf("number");
  expect(now).toBeGreaterThanOrEqual(before - 5);
  expect(now).toBeLessThanOrEqual(after + 5);
});

test("systemClock never decreases across consecutive calls", () => {
  let previous = systemClock();

  for (let i = 0; i < 1000; i++) {
    const current = systemClock();
    expect(current).toBeGreaterThanOrEqual(previous);
    previous = current;
  }
});
