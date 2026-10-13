import type { Level } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import { consoleMethodFor, type ConsoleLike } from "./formatter";

const routes: [Level, keyof ConsoleLike][] = [
  ["trace", "debug"],
  ["debug", "debug"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
  ["fatal", "error"],
];

describe("consoleMethodFor", () => {
  test.for(routes)("routes %s to console.%s", ([level, method]) => {
    expect(consoleMethodFor(level)).toBe(method);
  });

  test("never routes a level to console.trace", () => {
    for (const [level] of routes) {
      expect(consoleMethodFor(level)).not.toBe("trace");
    }
  });
});
