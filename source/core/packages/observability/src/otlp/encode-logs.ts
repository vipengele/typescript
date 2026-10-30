import type { SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { LogRecord } from "../logger/record";
import { type AnyValue, type KeyValue, toKeyValues } from "./any-value";
import { severityOf } from "./severity";
import { millisToNanoString } from "./time";

/** The semantic-conventions version the mapping targets, raised deliberately rather than followed (ADR-0008). */
export const SEMCONV_SCHEMA_URL = "https://opentelemetry.io/schemas/1.37.0";

/** One record to export, the Resource it was written with, and when the exporter observed it. */
export interface LogEntry {
  readonly record: LogRecord;
  readonly resource: Resource;
  /** Epoch milliseconds, sub-millisecond fraction included, at which the record reached the exporter. */
  readonly observedMs: number;
}

/** The Resource keys, in the order they are written as resource attributes. */
const RESOURCE_KEYS = [
  "service.name",
  "service.version",
  "service.dist",
  "deployment.environment.name",
  "process.runtime.name",
  "process.runtime.version",
  "os.type",
  "os.version",
  "browser.name",
  "browser.version",
  "device.type",
] as const satisfies readonly (keyof Resource)[];

const EXCEPTION_TYPE = "exception.type";
const EXCEPTION_MESSAGE = "exception.message";
const EXCEPTION_STACKTRACE = "exception.stacktrace";
const EXCEPTION_KEYS: ReadonlySet<string> = new Set([EXCEPTION_TYPE, EXCEPTION_MESSAGE, EXCEPTION_STACKTRACE]);

/** A V8 stack frame line; the lines before the first one are V8's own `name: message` header. */
const V8_FRAME = /^\s+at /;

interface ResourceGroup {
  readonly resource: Resource;
  readonly scopes: Map<string, unknown[]>;
}

/**
 * Encodes `entries` as an OTLP/HTTP JSON `ExportLogsServiceRequest` body (ADR-0007, ADR-0008).
 *
 * Entries are grouped into one `ResourceLogs` per distinct Resource *value*, compared key by key,
 * never by identity: a provider reads a fresh Resource object for every record, so identity would
 * give each record a `ResourceLogs` of its own. Within a Resource, records are grouped into one
 * `ScopeLogs` per Category, the Category being the instrumentation scope's name. Groups appear in
 * the order their first entry does, and entries keep their order within a group.
 */
export function encodeLogs(entries: ReadonlyArray<LogEntry>): string {
  const groups = new Map<string, ResourceGroup>();
  for (const { record, resource, observedMs } of entries) {
    const key = resourceKey(resource);
    let group = groups.get(key);
    if (group === undefined) {
      group = { resource, scopes: new Map() };
      groups.set(key, group);
    }
    let records = group.scopes.get(record.category);
    if (records === undefined) {
      records = [];
      group.scopes.set(record.category, records);
    }
    records.push(encodeRecord(record, observedMs));
  }

  const resourceLogs = [...groups.values()].map(({ resource, scopes }) => ({
    resource: { attributes: resourceAttributes(resource) },
    scopeLogs: [...scopes].map(([name, logRecords]) => ({ scope: { name }, logRecords, schemaUrl: SEMCONV_SCHEMA_URL })),
    schemaUrl: SEMCONV_SCHEMA_URL,
  }));
  return JSON.stringify({ resourceLogs });
}

/** The Resource's values as one string, equal for two Resources exactly when every key's value is. */
function resourceKey(resource: Resource): string {
  return JSON.stringify(RESOURCE_KEYS.map((key) => resource[key] ?? null));
}

/** The Resource as OTLP attributes, in {@link RESOURCE_KEYS} order; a key with no value is left out. */
export function resourceAttributes(resource: Resource): KeyValue[] {
  const attributes: KeyValue[] = [];
  for (const key of RESOURCE_KEYS) {
    const value = resource[key];
    if (value !== undefined) {
      attributes.push({ key, value: { stringValue: value } });
    }
  }
  return attributes;
}

function encodeRecord(record: LogRecord, observedMs: number): Record<string, unknown> {
  const body: AnyValue = { stringValue: record.message };
  const encoded: Record<string, unknown> = {
    timeUnixNano: millisToNanoString(record.time),
    observedTimeUnixNano: millisToNanoString(observedMs),
    ...severityOf(record.level),
    body,
    attributes: recordAttributes(record),
  };
  if (record.trace !== undefined) {
    encoded.traceId = record.trace.traceId.toLowerCase();
    encoded.spanId = record.trace.spanId.toLowerCase();
    encoded.flags = record.trace.flags;
  }
  return encoded;
}

/**
 * The record's attributes, then, when it carries an error, `exception.type`, `exception.message`
 * and `exception.stacktrace`. The error's keys win: a record attribute of the same name is left out,
 * since OTLP attribute keys are unique.
 */
function recordAttributes(record: LogRecord): KeyValue[] {
  const attributes = toKeyValues(record.attributes);
  if (record.error === undefined) {
    return attributes;
  }
  return [...attributes.filter(({ key }) => !EXCEPTION_KEYS.has(key)), ...exceptionAttributes(record.error)];
}

/**
 * The `exception.*` attributes of an error chain: `exception.type` and `exception.message` from the
 * outermost error, `exception.stacktrace` the whole chain as {@link exceptionStacktrace} lays it out.
 */
export function exceptionAttributes(error: SerializedError): KeyValue[] {
  return [
    { key: EXCEPTION_TYPE, value: { stringValue: error.type } },
    { key: EXCEPTION_MESSAGE, value: { stringValue: error.message } },
    { key: EXCEPTION_STACKTRACE, value: { stringValue: exceptionStacktrace(error) } },
  ];
}

/**
 * An error chain as text in the JVM's layout (ADR-0007): each error is a `type: message` header line
 * (`type` alone for an empty message) followed by its stack frames; the errors of an
 * `AggregateError` follow as `Suppressed:` blocks indented one tab, each with its own chain inside
 * it; the `cause` follows as a `Caused by:` block at the same depth.
 *
 * A V8 stack opens with its own `name: message` header, which is dropped in favour of the error's
 * header so the message is not written twice; a stack with no V8 frame that starts with the header
 * loses that prefix, and any other stack (SpiderMonkey's and JavaScriptCore's carry no header) is
 * kept whole. Blank lines are dropped.
 */
export function exceptionStacktrace(error: SerializedError): string {
  return chainLines(error).join("\n");
}

function chainLines(error: SerializedError): string[] {
  const header = error.message === "" ? error.type : `${error.type}: ${error.message}`;
  const lines = [header, ...frameLines(error.stack, header)];
  for (const suppressed of error.errors ?? []) {
    const [first, ...rest] = chainLines(suppressed);
    lines.push(`\tSuppressed: ${first}`, ...rest.map((line) => `\t${line}`));
  }
  if (error.cause !== undefined) {
    const [first, ...rest] = chainLines(error.cause);
    lines.push(`Caused by: ${first}`, ...rest);
  }
  return lines;
}

function frameLines(stack: string | undefined, header: string): string[] {
  if (stack === undefined) {
    return [];
  }
  let lines = stack.split("\n");
  const firstFrame = lines.findIndex((line) => V8_FRAME.test(line));
  if (firstFrame >= 0) {
    lines = lines.slice(firstFrame);
  } else if (stack.startsWith(header)) {
    lines = stack.slice(header.length).split("\n");
  }
  return lines.filter((line) => line.trim() !== "");
}
