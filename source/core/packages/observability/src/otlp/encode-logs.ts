import type { Resource } from "@vipengele/ts-core-common/scope";
import type { LogRecord } from "../logger/record";
import { type AnyValue, type KeyValue, toKeyValues } from "./any-value";
import { EXCEPTION_KEYS, exceptionAttributes } from "./exception";
import { groupByResource, resourceAttributes, SEMCONV_SCHEMA_URL } from "./resource";
import { severityOf } from "./severity";
import { millisToNanoString } from "./time";

/** One record to export, the Resource it was written with, and when the exporter observed it. */
export interface LogEntry {
  readonly record: LogRecord;
  readonly resource: Resource;
  /** Epoch milliseconds, sub-millisecond fraction included, at which the record reached the exporter. */
  readonly observedMs: number;
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
  const resourceLogs = groupByResource(
    entries,
    ({ record }) => record.category,
    ({ record, observedMs }) => encodeRecord(record, observedMs),
  ).map(({ resource, scopes }) => ({
    resource: { attributes: resourceAttributes(resource) },
    scopeLogs: [...scopes].map(([name, logRecords]) => ({ scope: { name }, logRecords, schemaUrl: SEMCONV_SCHEMA_URL })),
    schemaUrl: SEMCONV_SCHEMA_URL,
  }));
  return JSON.stringify({ resourceLogs });
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
