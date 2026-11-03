import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import type { ErrorEvent, ExceptionRecord } from "../errors/event";
import { ERROR_EVENT_SCOPE, encodeErrorEvents } from "./encode-error-events";
import { SEMCONV_SCHEMA_URL } from "./resource";

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

const CHECKOUT: Resource = { ...EMPTY_RESOURCE, "service.name": "checkout", "service.version": "1.2.3" };

const TRACE_ID = "abcdef0000000000abcdef0000000001";
const SPAN_ID = "abcdef0000000001";
const EVENT_ID = "aaaaaaaabbbbbbbbccccccccdddddddd";

function event(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    id: EVENT_ID,
    time: 1700000000123.456,
    level: "error",
    message: "hello",
    mechanism: { handled: true, source: "capture" },
    attributes: {},
    ...overrides,
  };
}

function exception(overrides: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return { type: "TypeError", message: "boom", stack: "TypeError: boom\n    at f (a.js:1:1)", frames: [], ...overrides };
}

interface DecodedLogRecord {
  readonly body: { readonly stringValue: string };
  readonly attributes: readonly { readonly key: string; readonly value: unknown }[];
  readonly [field: string]: unknown;
}

/** The parts of a decoded request the assertions read. */
interface DecodedRequest {
  readonly resourceLogs: {
    readonly resource: { readonly attributes: readonly unknown[] };
    readonly scopeLogs: {
      readonly scope: { readonly name: string };
      readonly logRecords: readonly DecodedLogRecord[];
    }[];
  }[];
}

function decode(body: string): DecodedRequest {
  return JSON.parse(body) as DecodedRequest;
}

function encodeOne(errorEvent: ErrorEvent): DecodedLogRecord {
  const logRecord = decode(encodeErrorEvents([{ event: errorEvent, resource: EMPTY_RESOURCE, observedMs: 1 }])).resourceLogs[0]
    ?.scopeLogs[0]?.logRecords[0];
  if (logRecord === undefined) {
    throw new Error("no log record encoded");
  }
  return logRecord;
}

function attributeOf(logRecord: DecodedLogRecord, key: string): unknown {
  return logRecord.attributes.find((attribute) => attribute.key === key)?.value;
}

describe("encodeErrorEvents", () => {
  test("encodes one captured message as a full ExportLogsServiceRequest", () => {
    const body = encodeErrorEvents([
      {
        event: event({
          level: "warn",
          attributes: { user: "ada", count: 3 },
          fingerprint: ["checkout", "payment"],
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
              scope: { name: "@vipengele/ts-core-observability/errors" },
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
                    { key: "log.record.uid", value: { stringValue: EVENT_ID } },
                    { key: "vipengele.mechanism.handled", value: { boolValue: true } },
                    { key: "vipengele.mechanism.source", value: { stringValue: "capture" } },
                    {
                      key: "vipengele.fingerprint",
                      value: { arrayValue: { values: [{ stringValue: "checkout" }, { stringValue: "payment" }] } },
                    },
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
    expect(ERROR_EVENT_SCOPE).toBe("@vipengele/ts-core-observability/errors");
  });

  test("leaves out trace fields, eventName and the fingerprint for an event with neither", () => {
    const logRecord = encodeOne(event());

    expect(Object.keys(logRecord)).toEqual([
      "timeUnixNano",
      "observedTimeUnixNano",
      "severityNumber",
      "severityText",
      "body",
      "attributes",
    ]);
    expect(logRecord.attributes.map(({ key }) => key)).toEqual([
      "log.record.uid",
      "vipengele.mechanism.handled",
      "vipengele.mechanism.source",
    ]);
  });

  test("encodes an exception with a cause chain as the outermost error's message and the whole chain's stacktrace", () => {
    const logRecord = encodeOne(
      event({
        level: "fatal",
        message: undefined,
        exception: exception({
          cause: exception({ type: "RangeError", message: "inner", stack: "RangeError: inner\n    at g (b.js:2:2)" }),
        }),
        mechanism: { handled: false, source: "global.error" },
      }),
    );

    expect(logRecord.severityNumber).toBe(21);
    expect(logRecord.body).toEqual({ stringValue: "boom" });
    expect(logRecord.attributes).toEqual([
      { key: "log.record.uid", value: { stringValue: EVENT_ID } },
      { key: "exception.type", value: { stringValue: "TypeError" } },
      { key: "exception.message", value: { stringValue: "boom" } },
      {
        key: "exception.stacktrace",
        value: {
          stringValue: "TypeError: boom\n    at f (a.js:1:1)\nCaused by: RangeError: inner\n    at g (b.js:2:2)",
        },
      },
      { key: "vipengele.mechanism.handled", value: { boolValue: false } },
      { key: "vipengele.mechanism.source", value: { stringValue: "global.error" } },
    ]);
  });

  test("uses the exception's type as the body when its message is empty", () => {
    const logRecord = encodeOne(event({ message: undefined, exception: exception({ message: "" }) }));

    expect(logRecord.body).toEqual({ stringValue: "TypeError" });
  });

  test("prefers the event's message over the exception's as the body when both are present", () => {
    expect(encodeOne(event({ message: "explicit", exception: exception() })).body).toEqual({ stringValue: "explicit" });
  });

  test("gives an event with neither a message nor an exception an empty body", () => {
    expect(encodeOne(event({ message: undefined })).body).toEqual({ stringValue: "" });
  });

  test("encodes mechanism data as a kvlist", () => {
    const logRecord = encodeOne(event({ mechanism: { handled: true, source: "integration.fetch", data: { status: 500, url: "/pay" } } }));

    expect(attributeOf(logRecord, "vipengele.mechanism.source")).toEqual({ stringValue: "integration.fetch" });
    expect(attributeOf(logRecord, "vipengele.mechanism.data")).toEqual({
      kvlistValue: {
        values: [
          { key: "status", value: { intValue: "500" } },
          { key: "url", value: { stringValue: "/pay" } },
        ],
      },
    });
  });

  test("drops an event attribute whose key the encoder writes, keeping the encoder's value", () => {
    const logRecord = encodeOne(
      event({
        message: undefined,
        exception: exception(),
        mechanism: { handled: true, source: "capture", data: { a: 1 } },
        fingerprint: ["fp"],
        attributes: {
          user: "ada",
          "log.record.uid": "mine",
          "exception.type": "mine",
          "exception.message": "mine",
          "exception.stacktrace": "mine",
          "vipengele.mechanism.handled": "mine",
          "vipengele.mechanism.source": "mine",
          "vipengele.mechanism.data": "mine",
          "vipengele.fingerprint": "mine",
        },
      }),
    );

    expect(logRecord.attributes.map(({ key }) => key)).toEqual([
      "user",
      "log.record.uid",
      "exception.type",
      "exception.message",
      "exception.stacktrace",
      "vipengele.mechanism.handled",
      "vipengele.mechanism.source",
      "vipengele.mechanism.data",
      "vipengele.fingerprint",
    ]);
    expect(logRecord.attributes.filter(({ value }) => JSON.stringify(value).includes("mine"))).toEqual([]);
  });

  test("keeps an event attribute whose key the encoder does not write for that event", () => {
    const logRecord = encodeOne(
      event({
        mechanism: { handled: true, source: "capture" },
        attributes: {
          "exception.type": "mine",
          "vipengele.mechanism.data": "mine",
          "vipengele.fingerprint": "mine",
        },
      }),
    );

    expect(logRecord.attributes.filter(({ value }) => JSON.stringify(value).includes("mine"))).toEqual([
      { key: "exception.type", value: { stringValue: "mine" } },
      { key: "vipengele.mechanism.data", value: { stringValue: "mine" } },
      { key: "vipengele.fingerprint", value: { stringValue: "mine" } },
    ]);
  });

  test("encodes no entries as an empty request", () => {
    expect(decode(encodeErrorEvents([]))).toEqual({ resourceLogs: [] });
  });

  test("groups by Resource value under one scope, in first-seen order", () => {
    const body = encodeErrorEvents([
      { event: event({ message: "1" }), resource: { ...CHECKOUT }, observedMs: 1 },
      { event: event({ message: "2" }), resource: { ...EMPTY_RESOURCE }, observedMs: 1 },
      { event: event({ message: "3" }), resource: { ...CHECKOUT }, observedMs: 1 },
      { event: event({ message: "4" }), resource: { ...EMPTY_RESOURCE }, observedMs: 1 },
    ]);
    const shape = decode(body).resourceLogs.map((group) => [
      group.resource.attributes.length,
      group.scopeLogs.map((scope) => [scope.scope.name, scope.logRecords.map((r) => r.body.stringValue)]),
    ]);

    expect(shape).toEqual([
      [2, [[ERROR_EVENT_SCOPE, ["1", "3"]]]],
      [0, [[ERROR_EVENT_SCOPE, ["2", "4"]]]],
    ]);
  });
});
