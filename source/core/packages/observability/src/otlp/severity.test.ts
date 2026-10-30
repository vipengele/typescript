import { describe, expect, test } from "vitest";
import { severityOf } from "./severity";

describe("severityOf", () => {
  test.each([
    ["trace", 1],
    ["debug", 5],
    ["info", 9],
    ["warn", 13],
    ["error", 17],
    ["fatal", 21],
  ] as const)("maps %s to the base of its OpenTelemetry range, %i, with the level as its text", (level, severityNumber) => {
    expect(severityOf(level)).toEqual({ severityNumber, severityText: level });
  });
});
