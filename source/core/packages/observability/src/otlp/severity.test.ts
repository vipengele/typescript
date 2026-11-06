import { describe, expect, test } from "vitest";
import { severityOf } from "./severity";

describe("severityOf", () => {
  test.each([
    ["trace", 1, "TRACE"],
    ["debug", 5, "DEBUG"],
    ["info", 9, "INFO"],
    ["warn", 13, "WARN"],
    ["error", 17, "ERROR"],
    ["fatal", 21, "FATAL"],
  ] as const)("maps %s to the base of its OpenTelemetry range, %i, with %s as its text", (level, severityNumber, severityText) => {
    expect(severityOf(level)).toEqual({ severityNumber, severityText });
  });
});
