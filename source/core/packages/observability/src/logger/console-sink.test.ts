import type { Level } from "@vipengele/ts-core-common";
import type { RuntimeSource } from "@vipengele/ts-core-common/runtime";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createConsoleSink } from "./console-sink";
import type { ConsoleLike, Formatter } from "./formatter";
import { ansiFormatter } from "./formatters/ansi";
import { browserFormatter } from "./formatters/browser";
import { jsonLinesFormatter } from "./formatters/json-lines";
import type { LogRecord } from "./record";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": "1.2.3",
  "service.dist": "web",
  "deployment.environment.name": "production",
  "process.runtime.name": "node",
  "process.runtime.version": "24.0.0",
  "os.type": "linux",
  "os.version": "6.1",
  "browser.name": "chrome",
  "browser.version": "126.0",
  "device.type": "desktop",
});

const RECORD: LogRecord = Object.freeze({
  time: 1_760_000_000_123.456,
  level: "info",
  category: "app.checkout",
  message: "order placed",
  attributes: Object.freeze({ orderId: "o-1" }),
});

const browserLike: RuntimeSource = { window: {}, document: {} };
const denoLike: RuntimeSource = { Deno: {}, process: { env: {}, stdout: { isTTY: true } } };
const nodeTerminal: RuntimeSource = { process: { versions: { node: "24.0.0" }, env: {}, stdout: { isTTY: true } } };
const nodePiped: RuntimeSource = { process: { versions: { node: "24.0.0" }, env: {}, stdout: { isTTY: false } } };

/** A console whose every method is a spy. */
function fakeConsole() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } satisfies ConsoleLike;
}

/** A formatter that returns `args` for every record. */
function fixedFormatter(args: readonly unknown[]) {
  return { format: vi.fn((_record: LogRecord, _resource: Resource) => args) } satisfies Formatter;
}

/** The arguments of the one `console.info` call a sink selecting from `source` makes for `RECORD`. */
function writtenArgs(source: RuntimeSource): unknown[] {
  const target = fakeConsole();
  createConsoleSink({ source, console: target }).write(RECORD, RESOURCE);
  expect(target.info).toHaveBeenCalledTimes(1);
  return target.info.mock.calls[0] as unknown[];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConsoleSink", () => {
  const routes: [Level, keyof ConsoleLike][] = [
    ["trace", "debug"],
    ["debug", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
    ["fatal", "error"],
  ];

  test.for(routes)("writes a %s record with console.%s and no other method", ([level, method]) => {
    const target = fakeConsole();
    const sink = createConsoleSink({ formatter: fixedFormatter(["line"]), console: target });

    sink.write({ ...RECORD, level }, RESOURCE);

    for (const name of ["error", "warn", "info", "debug"] as const) {
      expect(target[name]).toHaveBeenCalledTimes(name === method ? 1 : 0);
    }
    expect(target[method]).toHaveBeenCalledWith("line");
  });

  test("spreads the formatter's arguments into the console call in order", () => {
    const target = fakeConsole();
    const attributes = { a: 1 };
    const sink = createConsoleSink({ formatter: fixedFormatter(["%c%s", "color: red", "text", attributes]), console: target });

    sink.write(RECORD, RESOURCE);

    expect(target.info).toHaveBeenCalledTimes(1);
    expect(target.info.mock.calls[0]).toEqual(["%c%s", "color: red", "text", attributes]);
    expect(target.info.mock.calls[0]?.[3]).toBe(attributes);
  });

  test("hands the formatter the record and the resource passed to write", () => {
    const formatter = fixedFormatter([]);
    const sink = createConsoleSink({ formatter, console: fakeConsole() });

    sink.write(RECORD, RESOURCE);

    expect(formatter.format).toHaveBeenCalledTimes(1);
    expect(formatter.format.mock.calls[0]?.[0]).toBe(RECORD);
    expect(formatter.format.mock.calls[0]?.[1]).toBe(RESOURCE);
  });

  test("uses an explicit formatter over the one the source would select", () => {
    const target = fakeConsole();
    const sink = createConsoleSink({ formatter: fixedFormatter(["explicit"]), console: target, source: browserLike });

    sink.write(RECORD, RESOURCE);

    expect(target.info).toHaveBeenCalledWith("explicit");
  });

  test("selects the browser formatter for a browser-like source", () => {
    const args = writtenArgs(browserLike);

    expect(args).toEqual([...browserFormatter.format(RECORD, RESOURCE)]);
    expect(String(args[0]).startsWith("%c")).toBe(true);
  });

  test("selects the browser formatter for a Deno-like source with both capabilities", () => {
    const args = writtenArgs(denoLike);

    expect(String(args[0]).startsWith("%c")).toBe(true);
  });

  test("selects the ANSI formatter for a Node terminal", () => {
    const args = writtenArgs(nodeTerminal);

    expect(args).toEqual([...ansiFormatter.format(RECORD, RESOURCE)]);
    expect(args[0]).toBe("%s");
    expect(String(args[1])).toContain("\u001b[");
  });

  test("selects JSON lines for piped output", () => {
    const args = writtenArgs(nodePiped);

    expect(args).toEqual([...jsonLinesFormatter.format(RECORD, RESOURCE)]);
    expect(args[0]).toBe("%s");
    expect(String(args[1])).not.toContain("\u001b[");
    expect(JSON.parse(String(args[1]))).toMatchObject({ message: RECORD.message });
  });

  test("selects the formatter once, when the sink is created", () => {
    const env: Record<string, unknown> = {};
    const source: RuntimeSource = { process: { versions: { node: "24.0.0" }, env, stdout: { isTTY: true } } };
    const target = fakeConsole();
    const sink = createConsoleSink({ source, console: target });

    env.NO_COLOR = "1";
    sink.write(RECORD, RESOURCE);

    expect(target.info.mock.calls[0]).toEqual([...ansiFormatter.format(RECORD, RESOURCE)]);
  });

  test("without a console option, reads globalThis.console at each write", () => {
    const sink = createConsoleSink({ formatter: fixedFormatter(["global"]) });
    const info = vi.spyOn(globalThis.console, "info").mockImplementation(() => undefined);

    sink.write(RECORD, RESOURCE);

    expect(info).toHaveBeenCalledWith("global");
  });

  test("without a formatter or a source, writes with the formatter the host selects", () => {
    const sink = createConsoleSink();
    const debug = vi.spyOn(globalThis.console, "debug").mockImplementation(() => undefined);

    sink.write({ ...RECORD, level: "debug" }, RESOURCE);

    expect(debug).toHaveBeenCalledTimes(1);
    const record: LogRecord = { ...RECORD, level: "debug" };
    const expected = [browserFormatter, ansiFormatter, jsonLinesFormatter].map((formatter) => [...formatter.format(record, RESOURCE)]);
    expect(expected).toContainEqual(debug.mock.calls[0]);
  });

  test("lets a throwing formatter propagate out of write", () => {
    const failure = new Error("format failed");
    const target = fakeConsole();
    const sink = createConsoleSink({
      formatter: {
        format() {
          throw failure;
        },
      },
      console: target,
    });

    expect(() => sink.write(RECORD, RESOURCE)).toThrow(failure);
    expect(target.info).not.toHaveBeenCalled();
  });

  test("lets a throwing console method propagate out of write", () => {
    const failure = new Error("console failed");
    const target = fakeConsole();
    target.warn.mockImplementation(() => {
      throw failure;
    });
    const sink = createConsoleSink({ formatter: fixedFormatter(["line"]), console: target });

    expect(() => sink.write({ ...RECORD, level: "warn" }, RESOURCE)).toThrow(failure);
  });
});
