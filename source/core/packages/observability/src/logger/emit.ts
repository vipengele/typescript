import {
  type Attributes,
  type AttributesInput,
  type Level,
  normalizeAttributes,
  type SerializedError,
  serializeError,
  toJsonSafe,
} from "@vipengele/ts-core-common";
import { type Resource, Scope, snapshot } from "@vipengele/ts-core-common/scope";
import { mergeAttributes } from "../merge-attributes";
import { redactAttributes, redactError } from "../redaction";
import type { AttributesThunk } from "./logger";
import { isNormalized, markNormalized } from "./normalized";
import type { EmitSettings, LogProcessor, LogRecord, Sink } from "./record";
import { isSpanId, isTraceFlags, isTraceId, type LogTrace, readActiveTrace } from "./trace";

/**
 * One layer of a Logger's bindings, read once for each record the Logger builds. `read` returns
 * attributes that are already normalized and deeply frozen, and never throws.
 */
export interface BindingLayer {
  read(): Attributes;
}

/**
 * Freezes `value` and every object and array beneath it. A record and a Logger's bindings hold
 * only JSON-safe data that `normalizeAttributes`, `serializeError`, `redact` and
 * {@link acceptProcessorOutput} built for them, acyclic, so the walk ends and never reaches an
 * object of the caller's or of a processor's.
 */
export function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      freezeDeep(entry);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The current Scope's attributes, from the default scope inward, never the Resource. A throw while
 * reading or normalizing them yields an empty record, so the record still goes out with the
 * Logger's bindings and the call's own attributes instead of being dropped.
 */
function scopeAttributes(): Attributes {
  try {
    return normalizeAttributes(snapshot(Scope.current()));
  } catch {
    return {};
  }
}

/** Whether an attributes thunk is running in this module copy, so a thunk that logs never runs a thunk. */
let evaluating = false;

/**
 * What `thunk` returns, normalized, or `undefined` when it throws or is asked for while a thunk is
 * already running. A thunk that logs from inside itself would otherwise run itself again for every
 * nested record, until a `RangeError` caught at each frame wrote one record per frame. A result that
 * is not a plain record — a string, an array, `null`, `undefined` — normalizes to `{}`.
 */
export function evaluateAttributes(thunk: AttributesThunk): Attributes | undefined {
  if (evaluating) {
    return undefined;
  }
  evaluating = true;
  try {
    const value: unknown = thunk();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? normalizeAttributes(value as AttributesInput) : {};
  } catch {
    return undefined;
  } finally {
    evaluating = false;
  }
}

/**
 * A call's own attributes, normalized. A thunk runs here, once per record however many sinks
 * receive it; one that throws, or runs while a thunk is already running, yields an empty record, so
 * the record still goes out with the Scope's attributes and the bindings.
 */
function callAttributes(attributes: AttributesInput | AttributesThunk | undefined): Attributes {
  if (typeof attributes === "function") {
    return evaluateAttributes(attributes) ?? {};
  }
  return normalizeAttributes(attributes ?? {});
}

/**
 * The deeply frozen, marked record for one call. Its attributes merge from least to most specific — the
 * current Scope's, then each of the Logger's `bindings` layers in order, then the call's — each layer
 * normalized on its own, so the call wins a shared key over the bindings, a later binding layer over
 * an earlier one and the bindings over the Scope. They are redacted as one record, so a secret key is masked whichever layer it came from. Freezing the record, its attributes and every link of its
 * error lets every sink receive the same object without one sink's writes, at any depth, changing
 * what the next one sees. The span active in OpenTelemetry, when there is one, is read here and
 * carried as the record's `trace`; with none the record has no `trace` key.
 */
function createRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | AttributesThunk | undefined,
  error: unknown,
  bindings: readonly BindingLayer[],
): LogRecord {
  const time = settings.clock();
  const normalized = mergeAttributes([scopeAttributes(), ...bindings.map((layer) => layer.read()), callAttributes(attributes)]);
  const serialized = error === undefined ? undefined : serializeError(error);
  const trace = readActiveTrace();
  const policy = settings.redaction;
  const record: { -readonly [K in keyof LogRecord]: LogRecord[K] } = {
    time,
    level,
    category,
    message,
    attributes: policy === null ? normalized : redactAttributes(normalized, policy),
  };
  if (serialized !== undefined) {
    record.error = policy === null ? serialized : redactError(serialized, policy);
  }
  if (trace !== undefined) {
    record.trace = trace;
  }
  return markNormalized(freezeDeep(record));
}

/** Rebuilt in place of a link that is already on the path from the outermost error, as `serializeError` does. */
const CIRCULAR_LINK: SerializedError = { type: "[Circular]", message: "an error already on this chain" };

/**
 * `serializeError`'s default `maxLinks` and `maxErrors`, the limits {@link createRecord} serializes
 * a thrown value under, so a processor's error has the same link and error-count limits as the
 * record's own error.
 */
const MAX_LINKS = 5;
const MAX_ERRORS = 100;

/** Rebuilt in place of a link further than {@link MAX_LINKS} links from the outermost error, as `serializeError` does. */
const TRUNCATED_LINK: SerializedError = { type: "[Truncated]", message: `the chain continues past ${MAX_LINKS} links` };

/** `value` cut at the default string length and suffixed with the marker `serializeError` uses. */
function boundString(value: string): string {
  return toJsonSafe(value) as string;
}

/**
 * Every link of `error`'s chain and every link's `data`. They were built by `serializeError` or
 * accepted here earlier, already bounded, and are frozen, so a processor's error that reuses one of
 * them keeps it as it is rather than normalizing, and truncating, it a second time.
 */
function chainParts(error: SerializedError | undefined, parts: Set<object> = new Set()): Set<object> {
  if (error !== undefined) {
    parts.add(error);
    if (error.data !== undefined) {
      parts.add(error.data);
    }
    chainParts(error.cause, parts);
    for (const entry of error.errors ?? []) {
      chainParts(entry, parts);
    }
  }
  return parts;
}

/**
 * A fresh copy of one link of a processor's error, `links` links from the outermost one, holding
 * only the fields a {@link SerializedError} has. Its `message` and `stack` are cut and the link and
 * error-count limits apply, as for a thrown error; its `type` and `code` are cut as well, because a
 * processor's strings are arbitrary. A link from `known` is kept as it is. A link already on `path`, the links from the
 * outermost one down to this one, becomes a `"[Circular]"` link, and one further than
 * {@link MAX_LINKS} links out a `"[Truncated]"` link, read no further, so the walk ends however deep
 * the processor's chain goes. Anything else must be an object with a string `type` and `message`,
 * or this throws a `TypeError`. Its `type`, `message`, and a `code` or `stack` that is a string, are
 * cut at the default string length with the `"…[truncated]"` suffix; a `code` or `stack` that is
 * not a string and a `synthetic` that is not `true` are left out; `data` goes through
 * `normalizeAttributes`; and `errors` is kept only when it is an array, its first
 * {@link MAX_ERRORS} entries rebuilt and the rest summarised by one `"[Truncated]"` entry. The copy
 * is acyclic, JSON-safe, bounded, and shares no object with the processor's.
 */
function acceptErrorLink(link: unknown, links: number, known: ReadonlySet<object>, path: Set<unknown>): SerializedError {
  if (known.has(link as object)) {
    return link as SerializedError;
  }
  if (path.has(link)) {
    return { ...CIRCULAR_LINK };
  }
  if (links > MAX_LINKS) {
    return { ...TRUNCATED_LINK };
  }
  if (typeof link !== "object" || link === null) {
    throw new TypeError("A log processor returned an error link that is not an object");
  }
  const candidate = link as Partial<SerializedError>;
  if (typeof candidate.type !== "string" || typeof candidate.message !== "string") {
    throw new TypeError("A log processor returned an error link without a string type and message");
  }
  const accepted: SerializedError = { type: boundString(candidate.type), message: boundString(candidate.message) };
  if (typeof candidate.code === "string") {
    accepted.code = boundString(candidate.code);
  }
  if (typeof candidate.stack === "string") {
    accepted.stack = boundString(candidate.stack);
  }
  if (candidate.synthetic === true) {
    accepted.synthetic = true;
  }
  if (candidate.data !== undefined) {
    accepted.data = known.has(candidate.data) ? candidate.data : normalizeAttributes(candidate.data ?? {});
  }
  path.add(link);
  if (candidate.cause !== undefined) {
    accepted.cause = acceptErrorLink(candidate.cause, links + 1, known, path);
  }
  if (Array.isArray(candidate.errors)) {
    const entries: unknown[] = candidate.errors;
    accepted.errors = entries.slice(0, MAX_ERRORS).map((entry) => acceptErrorLink(entry, links + 1, known, path));
    if (entries.length > MAX_ERRORS) {
      accepted.errors.push({ type: "[Truncated]", message: `${entries.length - MAX_ERRORS} more errors` });
    }
  }
  path.delete(link);
  return accepted;
}

/**
 * A fresh copy of a processor's `trace`, holding only the {@link LogTrace} fields. It must be an
 * object whose `traceId` and `spanId` obey the hex rules {@link readActiveTrace} applies and whose
 * `flags` is an integer, or this throws a `TypeError`. Each field is read once, and the processor's
 * object is neither kept nor frozen.
 */
function acceptTrace(trace: unknown): LogTrace {
  if (typeof trace !== "object" || trace === null) {
    throw new TypeError("A log processor returned a trace that is not an object");
  }
  const { traceId, spanId, flags } = trace as Partial<LogTrace>;
  if (!isTraceId(traceId) || !isSpanId(spanId) || !isTraceFlags(flags)) {
    throw new TypeError("A log processor returned a trace without a valid traceId, spanId and integer flags");
  }
  return { traceId, spanId, flags };
}

/**
 * What a processor handed `previous` returned, made safe for the next processor or a sink. `null`
 * passes through as a drop, and `previous` itself is returned as it is, already frozen. Anything
 * else must be an object carrying a numeric `time` and a string `level`, `category` and `message`,
 * or this throws a `TypeError`.
 *
 * The accepted record is rebuilt from the {@link LogRecord} fields alone, so any other key the
 * processor set is left out. Its attributes go back through `normalizeAttributes` and its error
 * through {@link acceptErrorLink}, which cuts `message` and `stack` and applies the link and
 * error-count limits as for a thrown error, and also cuts `type` and `code`, because a processor's
 * strings are arbitrary. Its `trace` goes through {@link acceptTrace}; one that is `undefined` or
 * left out gives a record without a `trace`, so a processor may add, replace or strip it. Parts that
 * are `previous`'s own are kept rather than bounded a second time.
 * Nothing that is cyclic, unbounded or not JSON-safe reaches `freezeDeep`, and
 * the deep freeze walks only fresh copies and `previous`'s already frozen parts, never an object
 * of the processor's. A record {@link markNormalized} marked — one `redactionProcessor` built from a
 * marked record — is checked for the same field types, then taken through {@link acceptNormalized}
 * without normalizing its attributes or error again. The accepted record is marked in turn.
 */
function acceptProcessorOutput(previous: LogRecord, next: unknown): LogRecord | null {
  if (next === null) {
    return null;
  }
  if (next === previous) {
    return previous;
  }
  if (typeof next !== "object") {
    throw new TypeError(`A log processor returned ${typeof next} instead of a record or null`);
  }
  const candidate = next as Partial<LogRecord>;
  if (
    typeof candidate.time !== "number" ||
    typeof candidate.level !== "string" ||
    typeof candidate.category !== "string" ||
    typeof candidate.message !== "string"
  ) {
    throw new TypeError("A log processor returned a record without a numeric time and a string level, category and message");
  }
  if (isNormalized(candidate)) {
    return acceptNormalized(candidate);
  }
  const record: { -readonly [K in keyof LogRecord]: LogRecord[K] } = {
    time: candidate.time,
    level: candidate.level,
    category: candidate.category,
    message: candidate.message,
    attributes: candidate.attributes === previous.attributes ? previous.attributes : normalizeAttributes(candidate.attributes ?? {}),
  };
  if (candidate.error !== undefined) {
    record.error = acceptErrorLink(candidate.error, 0, chainParts(previous.error), new Set());
  }
  if (candidate.trace !== undefined) {
    record.trace = candidate.trace === previous.trace ? previous.trace : acceptTrace(candidate.trace);
  }
  return markNormalized(freezeDeep(record));
}

/**
 * A record {@link markNormalized} marked, rebuilt from the {@link LogRecord} fields alone. Its
 * attributes, error and trace are already JSON-safe, bounded and deeply frozen, so they are kept
 * as they are rather than normalized a second time, and only the rebuilt record itself is frozen.
 */
function acceptNormalized(candidate: LogRecord): LogRecord {
  const record: { -readonly [K in keyof LogRecord]: LogRecord[K] } = {
    time: candidate.time,
    level: candidate.level,
    category: candidate.category,
    message: candidate.message,
    attributes: candidate.attributes,
  };
  if (candidate.error !== undefined) {
    record.error = candidate.error;
  }
  if (candidate.trace !== undefined) {
    record.trace = candidate.trace;
  }
  return markNormalized(Object.freeze(record));
}

/** Reports a failed sink or processor; a throw from the report itself is swallowed. */
function reportFailure(settings: EmitSettings, thrown: unknown, source: Sink | LogProcessor): void {
  try {
    settings.onSinkError(thrown, source);
  } catch {
    // Reporting a failure never breaks the call that emitted the record.
  }
}

/**
 * `record` passed through `processors` in order, each on what the previous one returned, or `null`
 * as soon as one of them drops it. A processor that throws, or returns something
 * {@link acceptProcessorOutput} rejects, also yields `null` and is reported as the source of the
 * failure: the stage fails closed, and never throws itself.
 */
function runProcessors(settings: EmitSettings, processors: readonly LogProcessor[], record: LogRecord): LogRecord | null {
  let current = record;
  for (const processor of processors) {
    let next: LogRecord | null;
    try {
      next = acceptProcessorOutput(current, processor(current));
    } catch (thrown) {
      reportFailure(settings, thrown, processor);
      return null;
    }
    if (next === null) {
      return null;
    }
    current = next;
  }
  return current;
}

/**
 * Turns one enabled Logger call into a {@link LogRecord} and writes it, with the Resource in
 * force, to every sink of `settings`. Never throws. It checks no level: a Logger checks before
 * calling it, and a provider calls it directly for a console handle's confirmation, which no
 * category's level may suppress.
 *
 * `bindings` are the layers the Logger carries from `with`, each read once per record. They lie
 * over the current Scope's attributes, a later layer winning over an earlier one, and the call's
 * `attributes` win over all of them key by key. A throw while reading the Scope leaves its
 * attributes out rather than dropping the record.
 *
 * `attributes` given as a function runs only here, after the sink check and once per record. A
 * throw from it, a result that is not a record, or a run while another attributes thunk is running
 * yields an empty call layer: the record is still written, and nothing is reported.
 *
 * `error` is `undefined` when the call passed none; any other value, `null` included, is a thrown
 * value and is serialized into the record's `error`. With no sink configured nothing else is read
 * or run: neither the clock, nor the Scope, nor the bindings, nor the attributes or their thunk, nor
 * the error.
 *
 * The record carries the span active in OpenTelemetry as its `trace`, read only after the sink
 * check; a call with no sink never reads OpenTelemetry's registry, and a failed read leaves `trace`
 * out rather than dropping the record.
 *
 * Building the record — the clock, normalizing the attributes, serializing the error, redacting
 * them and asking for the Resource — runs inside one guard. A throw there drops the record: no
 * sink receives it, the caller does not see the throw, and nothing is reported, since
 * `onSinkError` is for sink and processor failures alone.
 *
 * The global processors run on the built record, then each sink's own processors on what the
 * global ones returned. The processor stage fails closed: a processor that throws, or returns
 * anything but `null` or an object with a numeric `time` and a string `level`, `category` and
 * `message`, or an `error` with a link that is not an object with a string `type` and `message`,
 * or a `trace` that is not an object with a valid `traceId`, `spanId` and integer `flags`, drops
 * the record exactly as a `null` does — for every sink when the processor is global, and the Resource is then not asked for; for its own sink alone when it is a per-sink one. Either way
 * the failure is reported to `onSinkError` with the processor as its source, and the caller does
 * not see the throw. A record a processor returns is rebuilt from the {@link LogRecord} fields
 * alone, its attributes and every link's `data` normalized again, its error chain bounded by
 * `serializeError`'s link and `errors` limits, each link's `message` and `stack` cut as for a thrown
 * error and its `type` and `code` cut as well because a processor's strings are arbitrary, and a
 * link that recurs on its own chain replaced by a `"[Circular]"` link, then deeply frozen, so every processor and every sink
 * receives a frozen, JSON-safe record and the processor's own objects stay unfrozen. The record
 * `redactionProcessor` returns is redacted from an already normalized record and deeply frozen,
 * and is taken without that second normalization.
 *
 * Each `write` runs in its own guard that reports to `onSinkError` with the sink as its source, so
 * every sink is tried.
 * Whatever `write` returns is ignored: a returned promise is neither awaited nor observed, and a
 * rejection of it is the sink's own to handle.
 */
export function emitRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | AttributesThunk | undefined,
  error: unknown,
  bindings: readonly BindingLayer[] = [],
): void {
  const { sinks } = settings;
  if (sinks.length === 0) {
    return;
  }

  let record: LogRecord | null;
  let resource: Resource;
  try {
    record = runProcessors(settings, settings.processors, createRecord(settings, level, category, message, attributes, error, bindings));
    if (record === null) {
      return;
    }
    resource = settings.resource();
  } catch {
    return;
  }

  for (const { sink, processors } of sinks) {
    const delivered = runProcessors(settings, processors, record);
    if (delivered === null) {
      continue;
    }
    try {
      sink.write(delivered, resource);
    } catch (thrown) {
      reportFailure(settings, thrown, sink);
    }
  }
}
