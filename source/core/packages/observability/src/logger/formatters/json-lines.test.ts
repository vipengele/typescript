import type { SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import type { LogRecord } from "../record";
import { jsonLinesFormatter } from "./json-lines";

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
  attributes: Object.freeze({ orderId: "o-1", items: 3, paid: true, tags: Object.freeze(["a", "b"]) }),
});

/** The formatter's output for `record`, asserted to be `["%s", line]` and with the line parsed. */
function formatted(record: LogRecord, resource: Resource = RESOURCE): { line: string; parsed: Record<string, unknown> } {
  const args = jsonLinesFormatter.format(record, resource);
  expect(args).toHaveLength(2);
  expect(args[0]).toBe("%s");
  const line = args[1];
  expect(typeof line).toBe("string");
  return { line: line as string, parsed: JSON.parse(line as string) as Record<string, unknown> };
}

describe("jsonLinesFormatter", () => {
  test("returns the record and the resource as one line that parses back to them", () => {
    const { parsed } = formatted(RECORD);

    expect(parsed).toEqual({
      time: RECORD.time,
      level: RECORD.level,
      category: RECORD.category,
      message: RECORD.message,
      attributes: RECORD.attributes,
      resource: RESOURCE,
    });
  });

  test("writes the time as the record's epoch milliseconds, fraction included", () => {
    const times = [1_760_000_000_123.456, 1_760_000_000_123.457, 0.001, 1_760_000_000_000];
    for (const time of times) {
      const { line, parsed } = formatted({ ...RECORD, time });
      expect(parsed.time).toBe(time);
      expect(line).toContain(`"time":${String(time)},`);
    }
  });

  test("keeps the key order time, level, category, message, attributes, error, resource", () => {
    const error: SerializedError = { type: "Error", message: "boom" };
    const { parsed } = formatted({ ...RECORD, error });

    expect(Object.keys(parsed)).toEqual(["time", "level", "category", "message", "attributes", "error", "resource"]);
  });

  test("omits the error key when the record carries no error", () => {
    const { parsed } = formatted(RECORD);

    expect(Object.keys(parsed)).toEqual(["time", "level", "category", "message", "attributes", "resource"]);
  });

  test("carries an error's whole cause and errors chain", () => {
    const error: SerializedError = {
      type: "AggregateError",
      message: "checkout failed",
      code: "checkout.failed",
      stack: "AggregateError: checkout failed\n    at pay (pay.ts:1:1)",
      data: { attempt: 2 },
      errors: [
        { type: "TypeError", message: "card declined" },
        { type: "Error", message: "42", synthetic: true },
      ],
      cause: {
        type: "Error",
        message: "gateway timeout",
        cause: { type: "RangeError", message: "socket closed" },
      },
    };
    const { parsed } = formatted({ ...RECORD, level: "error", error });

    expect(parsed.error).toEqual(error);
  });

  test("ends the line without a newline", () => {
    const { line } = formatted(RECORD);

    expect(line.endsWith("}")).toBe(true);
    expect(line).not.toContain("\n");
  });

  test("keeps format specifiers in the message, category and attributes intact behind %s", () => {
    const text = "disk 95%d full, %c styled, %s swallowed, 100% bare %";
    const record: LogRecord = {
      ...RECORD,
      category: "app.%d.%c.%s.%",
      message: text,
      attributes: { note: text, "%s": "%d", nested: { value: "%c%" } },
    };
    const { parsed } = formatted(record);

    expect(parsed.category).toBe("app.%d.%c.%s.%");
    expect(parsed.message).toBe(text);
    expect(parsed.attributes).toEqual({ note: text, "%s": "%d", nested: { value: "%c%" } });
  });

  test("serializes a resource whose values sit behind prototype getters", () => {
    class GetterResource implements Resource {
      get "service.name"() {
        return "checkout";
      }
      get "service.version"() {
        return "1.2.3";
      }
      get "service.dist"() {
        return undefined;
      }
      get "deployment.environment.name"() {
        return "production";
      }
      get "process.runtime.name"() {
        return "node";
      }
      get "process.runtime.version"() {
        return "24.0.0";
      }
      get "os.type"() {
        return "linux";
      }
      get "os.version"() {
        return "6.1";
      }
      get "browser.name"() {
        return undefined;
      }
      get "browser.version"() {
        return undefined;
      }
      get "device.type"() {
        return "desktop";
      }
    }
    const { parsed } = formatted(RECORD, new GetterResource());

    expect(parsed.resource).toEqual({
      "service.name": "checkout",
      "service.version": "1.2.3",
      "deployment.environment.name": "production",
      "process.runtime.name": "node",
      "process.runtime.version": "24.0.0",
      "os.type": "linux",
      "os.version": "6.1",
      "device.type": "desktop",
    });
  });
});
