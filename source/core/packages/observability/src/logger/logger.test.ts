import type { Threshold } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { entryFor } from "./levels";
import { createLogger } from "./logger";
import type { EmitSettings } from "./record";

/** Emit settings for a Logger whose `enabled` is under test; `enabled` never reads them. */
function emit(): EmitSettings {
  throw new Error("enabled never reads the emit settings");
}

describe("createLogger", () => {
  test("exposes its category and enabled, and nothing else", () => {
    const logger = createLogger("services.editing", () => entryFor("warn"), emit);

    expect(logger.category).toBe("services.editing");
    expect(Object.keys(logger).sort()).toEqual(["category", "enabled"]);
    expect(Object.isFrozen(logger)).toBe(true);
  });

  test("enables a level at or above the resolved threshold", () => {
    const logger = createLogger("a", () => entryFor("info"), emit);

    expect(logger.enabled("debug")).toBe(false);
    expect(logger.enabled("info")).toBe(true);
    expect(logger.enabled("fatal")).toBe(true);
  });

  test("an off threshold enables nothing", () => {
    const logger = createLogger("a", () => entryFor("off"), emit);

    expect(logger.enabled("fatal")).toBe(false);
  });

  test("asks the resolver for its own category on every call", () => {
    let threshold: Threshold = "error";
    const asked: string[] = [];
    const logger = createLogger(
      "a.b",
      (category) => {
        asked.push(category);
        return entryFor(threshold);
      },
      emit,
    );

    expect(logger.enabled("warn")).toBe(false);
    threshold = "trace";
    expect(logger.enabled("warn")).toBe(true);
    expect(asked).toEqual(["a.b", "a.b"]);
  });

  test("throws a LoggingConfigError on an invalid category, the root included", () => {
    for (const category of ["", "*", "a..b", "a:b", "a,b", "a.*"]) {
      expect(() => createLogger(category, () => entryFor("warn"), emit)).toThrow(expect.toSatisfy(isLoggingConfigError));
    }
  });
});
