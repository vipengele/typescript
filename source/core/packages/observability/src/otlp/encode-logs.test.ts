import type { SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import { Logging } from "../logger/logging";
import type { LogRecord } from "../logger/record";
import { encodeLogs, exceptionStacktrace, resourceAttributes, SEMCONV_SCHEMA_URL } from "./encode-logs";

const EMPTY_RESOURCE: Resource = {
  "service.name": undefined,
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
};

// biome-ignore lint/security/noSecrets: the W3C Trace Context example trace id, flagged only for its entropy
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

const CHECKOUT: Resource = { ...EMPTY_RESOURCE, "service.name": "checkout", "service.version": "1.2.3" };

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return { time: 1700000000123.456, level: "info", category: "app", message: "hello", attributes: {}, ...overrides };
}

/** The parts of a decoded request the assertions read. */
interface DecodedRequest {
  readonly resourceLogs: {
    readonly resource: { readonly attributes: readonly unknown[] };
    readonly scopeLogs: {
      readonly scope: { readonly name: string };
      readonly logRecords: { readonly body: { readonly stringValue: string }; readonly attributes: unknown }[];
    }[];
  }[];
}

function decode(body: string): DecodedRequest {
  return JSON.parse(body) as DecodedRequest;
}

describe("encodeLogs", () => {
  test("encodes one record as a full ExportLogsServiceRequest", () => {
    const body = encodeLogs([
      {
        record: record({
          level: "warn",
          attributes: { user: "ada", count: 3, ratio: 0.5, nested: { ok: true }, list: ["a"] },
          trace: { traceId: TRACE_ID.toUpperCase(), spanId: SPAN_ID.toUpperCase(), flags: 1 },
        }),
        resource: CHECKOUT,
        observedMs: 1700000000200.5,
      },
    ]);

    expect(decode(body)).toEqual({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "checkout" } },
              { key: "service.version", value: { stringValue: "1.2.3" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "app" },
              logRecords: [
                {
                  timeUnixNano: "1700000000123456000",
                  observedTimeUnixNano: "1700000000200500000",
                  severityNumber: 13,
                  severityText: "warn",
                  body: { stringValue: "hello" },
                  attributes: [
                    { key: "user", value: { stringValue: "ada" } },
                    { key: "count", value: { intValue: "3" } },
                    { key: "ratio", value: { doubleValue: 0.5 } },
                    { key: "nested", value: { kvlistValue: { values: [{ key: "ok", value: { boolValue: true } }] } } },
                    { key: "list", value: { arrayValue: { values: [{ stringValue: "a" }] } } },
                  ],
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  flags: 1,
                },
              ],
              schemaUrl: SEMCONV_SCHEMA_URL,
            },
          ],
          schemaUrl: SEMCONV_SCHEMA_URL,
        },
      ],
    });
    expect(SEMCONV_SCHEMA_URL).toBe("https://opentelemetry.io/schemas/1.37.0");
  });

  test("leaves out trace fields for a record with no trace", () => {
    const logRecord = decode(encodeLogs([{ record: record(), resource: EMPTY_RESOURCE, observedMs: 1 }])).resourceLogs[0]?.scopeLogs[0]
      ?.logRecords[0];

    expect(Object.keys(logRecord ?? {})).toEqual([
      "timeUnixNano",
      "observedTimeUnixNano",
      "severityNumber",
      "severityText",
      "body",
      "attributes",
    ]);
  });

  test("encodes no entries as an empty request", () => {
    expect(decode(encodeLogs([]))).toEqual({ resourceLogs: [] });
  });

  test("groups by Resource value and then by Category, in first-seen order", () => {
    const body = encodeLogs([
      { record: record({ category: "a", message: "1" }), resource: { ...CHECKOUT }, observedMs: 1 },
      { record: record({ category: "b", message: "2" }), resource: { ...EMPTY_RESOURCE }, observedMs: 1 },
      { record: record({ category: "b", message: "3" }), resource: { ...CHECKOUT }, observedMs: 1 },
      { record: record({ category: "a", message: "4" }), resource: { ...CHECKOUT }, observedMs: 1 },
      { record: record({ category: "b", message: "5" }), resource: { ...EMPTY_RESOURCE }, observedMs: 1 },
    ]);
    const resourceLogs = decode(body).resourceLogs;
    const shape = resourceLogs.map((group) => [
      group.resource.attributes.length,
      group.scopeLogs.map((scope) => [scope.scope.name, scope.logRecords.map((r) => r.body.stringValue)]),
    ]);

    expect(shape).toEqual([
      [
        2,
        [
          ["a", ["1", "4"]],
          ["b", ["3"]],
        ],
      ],
      [0, [["b", ["2", "5"]]]],
    ]);
  });

  test("puts two records written through a provider, each with its own Resource object, in one ResourceLogs", () => {
    const written: { record: LogRecord; resource: Resource }[] = [];
    const provider = Logging.createProvider((builder) =>
      builder.addLevels({ "*": "info" }).addSink({
        write(logRecord, resource) {
          written.push({ record: logRecord, resource });
        },
      }),
    );

    provider.logger("app").info("one");
    provider.logger("app").info("two");

    expect(written).toHaveLength(2);
    expect(written[0]?.resource).not.toBe(written[1]?.resource);
    const resourceLogs = decode(encodeLogs(written.map((entry) => ({ ...entry, observedMs: entry.record.time })))).resourceLogs;
    expect(resourceLogs).toHaveLength(1);
    expect(resourceLogs[0]?.scopeLogs).toHaveLength(1);
    expect(resourceLogs[0]?.scopeLogs[0]?.logRecords.map((r) => r.body.stringValue)).toEqual(["one", "two"]);
  });

  test("adds the exception attributes of an error after the record's own, which they replace on a clash", () => {
    const error: SerializedError = { type: "TypeError", message: "boom", stack: "TypeError: boom\n    at f (a.js:1:1)" };
    const attributes = decode(
      encodeLogs([
        {
          record: record({ level: "error", attributes: { user: "ada", "exception.type": "mine" }, error }),
          resource: EMPTY_RESOURCE,
          observedMs: 1,
        },
      ]),
    ).resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes;

    expect(attributes).toEqual([
      { key: "user", value: { stringValue: "ada" } },
      { key: "exception.type", value: { stringValue: "TypeError" } },
      { key: "exception.message", value: { stringValue: "boom" } },
      { key: "exception.stacktrace", value: { stringValue: "TypeError: boom\n    at f (a.js:1:1)" } },
    ]);
  });
});

describe("resourceAttributes", () => {
  test("writes every key that holds a value in the reserved order, and leaves out the rest", () => {
    const resource: Resource = {
      "service.name": "s",
      "service.version": "1",
      "service.dist": "d",
      "deployment.environment.name": "prod",
      "process.runtime.name": "node",
      "process.runtime.version": "24",
      "os.type": "linux",
      "os.version": "6",
      "browser.name": "chrome",
      "browser.version": "140",
      "device.type": "desktop",
    };

    expect(resourceAttributes(resource).map(({ key }) => key)).toEqual(Object.keys(resource));
    expect(resourceAttributes({ ...EMPTY_RESOURCE, "os.type": "linux" })).toEqual([{ key: "os.type", value: { stringValue: "linux" } }]);
    expect(resourceAttributes(EMPTY_RESOURCE)).toEqual([]);
  });
});

describe("exceptionStacktrace", () => {
  test("replaces a V8 stack's own header with the error's, keeping its frames", () => {
    const error: SerializedError = {
      type: "CustomError",
      message: "two\nlines",
      stack: "Error: two\nlines\n    at f (a.js:1:1)\n    at g (a.js:2:2)\n",
    };

    expect(exceptionStacktrace(error)).toBe("CustomError: two\nlines\n    at f (a.js:1:1)\n    at g (a.js:2:2)");
  });

  test("keeps a header-less stack whole", () => {
    const error: SerializedError = { type: "Error", message: "x", stack: "f@a.js:1:1\ng@a.js:2:2\n" };

    expect(exceptionStacktrace(error)).toBe("Error: x\nf@a.js:1:1\ng@a.js:2:2");
  });

  test("drops a frameless stack that is only the header", () => {
    expect(exceptionStacktrace({ type: "Error", message: "x", stack: "Error: x" })).toBe("Error: x");
  });

  test("writes the type alone for an empty message and a header alone without a stack", () => {
    expect(exceptionStacktrace({ type: "Error", message: "" })).toBe("Error");
    expect(exceptionStacktrace({ type: "Error", message: '{"a":1}', synthetic: true })).toBe('Error: {"a":1}');
  });

  test("lays out the cause chain in the JVM's Caused by layout", () => {
    const error: SerializedError = {
      type: "Error",
      message: "outer",
      stack: "Error: outer\n    at outer (a.js:1:1)",
      cause: {
        type: "RangeError",
        message: "middle",
        stack: "RangeError: middle\n    at middle (b.js:2:2)",
        cause: { type: "Error", message: "inner" },
      },
    };

    expect(exceptionStacktrace(error)).toBe(
      [
        "Error: outer",
        "    at outer (a.js:1:1)",
        "Caused by: RangeError: middle",
        "    at middle (b.js:2:2)",
        "Caused by: Error: inner",
      ].join("\n"),
    );
  });

  test("writes AggregateError errors as tab-indented Suppressed blocks ahead of the cause", () => {
    const error: SerializedError = {
      type: "AggregateError",
      message: "all failed",
      stack: "AggregateError: all failed\n    at run (a.js:1:1)",
      errors: [
        {
          type: "Error",
          message: "first",
          stack: "Error: first\n    at one (b.js:1:1)",
          cause: { type: "Error", message: "root" },
        },
        { type: "Error", message: "second" },
      ],
      cause: { type: "Error", message: "why" },
    };

    expect(exceptionStacktrace(error)).toBe(
      [
        "AggregateError: all failed",
        "    at run (a.js:1:1)",
        "\tSuppressed: Error: first",
        "\t    at one (b.js:1:1)",
        "\tCaused by: Error: root",
        "\tSuppressed: Error: second",
        "Caused by: Error: why",
      ].join("\n"),
    );
  });
});
