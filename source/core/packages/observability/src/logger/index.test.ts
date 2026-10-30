import { expect, test } from "vitest";
import * as entry from "./index";
import type { ConsoleLike, ConsoleSinkOptions, Formatter, LogProcessor, SinkOptions, SinkRegistration } from "./index";

test("the entry point exports exactly the public runtime surface", () => {
  expect(Object.keys(entry).sort()).toEqual([
    "LOGGING_CONFIG_ERROR_CODE",
    "Logging",
    "LoggingConfigError",
    "ansiFormatter",
    "browserFormatter",
    "createConsoleSink",
    // biome-ignore lint/security/noSecrets: an export name, flagged only for its entropy
    "createOtlpLogSink",
    "createTestSink",
    "isLoggingConfigError",
    "jsonLinesFormatter",
    "parseSpec",
    "redactionProcessor",
    "setWarnTarget",
  ]);
});

test("a Logger from the exported facade answers level queries", () => {
  const log = entry.Logging.logger("x");

  expect(log.enabled("error")).toBe(true);
  expect(log.enabled("debug")).toBe(false);
});

test("a provider built with a sink delivers a record and the resource to it", () => {
  const sink = entry.createTestSink();
  const provider = entry.Logging.createProvider((b) => b.addLevels({ "*": "info" }).addSink(sink));

  provider.logger("x").info("hi", { a: 1 });

  expect(sink.records).toHaveLength(1);
  expect(sink.resources).toHaveLength(1);
  expect(sink.records[0]).toMatchObject({ level: "info", category: "x", message: "hi", attributes: { a: 1 } });
  expect(typeof sink.records[0]?.time).toBe("number");
  expect(sink.records[0]?.error).toBeUndefined();
  expect(sink.resources[0]).toBeTypeOf("object");
});

test("the processor and sink registration types are exported", () => {
  const processor: LogProcessor = entry.redactionProcessor();
  const options: SinkOptions = {};
  const registration: SinkRegistration = { sink: { write: () => undefined }, processors: [processor] };

  expect(processor).toBeTypeOf("function");
  expect(options).toEqual({});
  expect(registration.processors).toEqual([processor]);
});

test("the console sink, formatter and console types are exported", () => {
  const options: ConsoleSinkOptions = {};
  const formatter: Formatter = entry.jsonLinesFormatter;
  const consoleLike: Pick<ConsoleLike, "info"> = { info: () => undefined };

  expect(entry.createConsoleSink(options)).toBeTypeOf("object");
  expect(formatter).toBe(entry.jsonLinesFormatter);
  expect(consoleLike.info).toBeTypeOf("function");
});
