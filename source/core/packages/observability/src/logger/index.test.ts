import { expect, test } from "vitest";
import * as entry from "./index";
import type { LogRecord, Sink } from "./index";

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

test("a provider built with a sink delivers a record and the resource to it", () => {
  const received: { record: LogRecord; resource: unknown }[] = [];
  const sink: Sink = { write: (record, resource) => received.push({ record, resource }) };
  const provider = entry.Logging.createProvider((b) => b.addLevels({ "*": "info" }).addSink(sink));

  provider.logger("x").info("hi", { a: 1 });

  expect(received).toHaveLength(1);
  expect(received[0]?.record).toMatchObject({ level: "info", category: "x", message: "hi", attributes: { a: 1 } });
  expect(typeof received[0]?.record.time).toBe("number");
  expect(received[0]?.record.error).toBeUndefined();
  expect(received[0]?.resource).toBeTypeOf("object");
});
