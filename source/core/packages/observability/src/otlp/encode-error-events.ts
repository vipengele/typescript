import type { Resource } from "@vipengele/ts-core-common/scope";
import type { ErrorEvent, ExceptionRecord } from "../errors/event";
import { type AnyValue, type KeyValue, toAnyValue, toKeyValues } from "./any-value";
import { exceptionAttributes } from "./exception";
import { groupByResource, resourceAttributes, SEMCONV_SCHEMA_URL } from "./resource";
import { severityOf } from "./severity";
import { millisToNanoString } from "./time";

/** One Error Event to export, the Resource the pipeline read for it, and when the exporter observed it. */
export interface ErrorEventEntry {
  readonly event: ErrorEvent;
  readonly resource: Resource;
  /** Epoch milliseconds, sub-millisecond fraction included, at which the event reached the exporter. */
  readonly observedMs: number;
}

/** The instrumentation scope name of every Error Event: the entry point that reports it. */
export const ERROR_EVENT_SCOPE = "@vipengele/ts-core-observability/errors";

const RECORD_UID = "log.record.uid";
const MECHANISM_HANDLED = "vipengele.mechanism.handled";
const MECHANISM_SOURCE = "vipengele.mechanism.source";
const MECHANISM_DATA = "vipengele.mechanism.data";
const FINGERPRINT = "vipengele.fingerprint";

/**
 * Encodes `entries` as an OTLP/HTTP JSON `ExportLogsServiceRequest` body (ADR-0007, ADR-0022), one
 * OTLP log record per Error Event.
 *
 * Entries are grouped into one `ResourceLogs` per distinct Resource *value*, compared key by key,
 * never by identity, each holding one `ScopeLogs` named {@link ERROR_EVENT_SCOPE}. Groups appear in
 * the order their first entry does, and entries keep their order within a group. `eventName` is
 * left unset: semantic conventions 1.37 record an exception on a log record through its
 * `exception.*` attributes alone, and a captured message is no named event.
 */
export function encodeErrorEvents(entries: ReadonlyArray<ErrorEventEntry>): string {
  const resourceLogs = groupByResource(
    entries,
    () => ERROR_EVENT_SCOPE,
    ({ event, observedMs }) => encodeEvent(event, observedMs),
  ).map(({ resource, scopes }) => ({
    resource: { attributes: resourceAttributes(resource) },
    scopeLogs: [...scopes].map(([name, logRecords]) => ({ scope: { name }, logRecords, schemaUrl: SEMCONV_SCHEMA_URL })),
    schemaUrl: SEMCONV_SCHEMA_URL,
  }));
  return JSON.stringify({ resourceLogs });
}

function encodeEvent(event: ErrorEvent, observedMs: number): Record<string, unknown> {
  const body: AnyValue = { stringValue: bodyOf(event) };
  const encoded: Record<string, unknown> = {
    timeUnixNano: millisToNanoString(event.time),
    observedTimeUnixNano: millisToNanoString(observedMs),
    ...severityOf(event.level),
    body,
    attributes: eventAttributes(event),
  };
  if (event.trace !== undefined) {
    encoded.traceId = event.trace.traceId.toLowerCase();
    encoded.spanId = event.trace.spanId.toLowerCase();
    encoded.flags = event.trace.flags;
  }
  return encoded;
}

/**
 * The record's body: a captured message's text, else the outermost exception's message, or its type
 * when the message is empty. An event carrying neither has an empty body.
 */
function bodyOf(event: ErrorEvent): string {
  if (event.message !== undefined) {
    return event.message;
  }
  return event.exception === undefined ? "" : exceptionBody(event.exception);
}

function exceptionBody(exception: ExceptionRecord): string {
  return exception.message === "" ? exception.type : exception.message;
}

/**
 * The event's own attributes, then `log.record.uid`, the `exception.*` keys when it carries an
 * exception, the mechanism and the fingerprint. A key the encoder writes for this event wins: an
 * event attribute of the same name is left out, since OTLP attribute keys are unique. A key it does
 * not write for this event, such as `exception.type` on a captured message, keeps the event's value.
 */
function eventAttributes(event: ErrorEvent): KeyValue[] {
  const exception = event.exception === undefined ? [] : exceptionAttributes(event.exception);
  const written: KeyValue[] = [
    { key: RECORD_UID, value: { stringValue: event.id } },
    ...exception,
    ...mechanismAttributes(event.mechanism),
    ...fingerprintAttributes(event.fingerprint),
  ];
  const writtenKeys = new Set(written.map(({ key }) => key));
  return [...toKeyValues(event.attributes).filter(({ key }) => !writtenKeys.has(key)), ...written];
}

function mechanismAttributes(mechanism: ErrorEvent["mechanism"]): KeyValue[] {
  const attributes: KeyValue[] = [
    { key: MECHANISM_HANDLED, value: { boolValue: mechanism.handled } },
    { key: MECHANISM_SOURCE, value: { stringValue: mechanism.source } },
  ];
  if (mechanism.data !== undefined) {
    attributes.push({ key: MECHANISM_DATA, value: toAnyValue(mechanism.data) });
  }
  return attributes;
}

function fingerprintAttributes(fingerprint: ErrorEvent["fingerprint"]): KeyValue[] {
  if (fingerprint === undefined) {
    return [];
  }
  return [{ key: FINGERPRINT, value: { arrayValue: { values: fingerprint.map((part) => ({ stringValue: part })) } } }];
}
