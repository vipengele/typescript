import { expect, test } from "vitest";
import * as entry from "./index";

test("the entry point exports exactly the public runtime surface", () => {
  expect(Object.keys(entry).sort()).toEqual([
    "LOGGING_CONFIG_ERROR_CODE",
    "Logging",
    "LoggingConfigError",
    "isLoggingConfigError",
    "parseSpec",
    "setWarnTarget",
  ]);
});

test("a Logger from the exported facade answers level queries", () => {
  const log = entry.Logging.logger("x");

  expect(log.enabled("error")).toBe(true);
  expect(log.enabled("debug")).toBe(false);
});
