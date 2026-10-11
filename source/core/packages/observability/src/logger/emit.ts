import { type Attributes, type AttributesInput, type Level, normalizeAttributes, serializeError } from "@vipengele/ts-core-common";
import { type Resource, Scope, snapshot } from "@vipengele/ts-core-common/scope";
import { mergeAttributes } from "../merge-attributes";
import { redactAttributes, redactError } from "../redaction";
import type { EmitSettings, LogProcessor, LogRecord } from "./record";

/**
 * Freezes `value` and every object and array beneath it. A record and a Logger's bindings hold
 * only JSON-safe data that `normalizeAttributes`, `serializeError` and `redact` built for them,
 * bounded and acyclic, so the walk ends and never reaches an object of the caller's.
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

/**
 * The deeply frozen record for one call. Its attributes merge from least to most specific — the
 * current Scope's, then the Logger's already normalized `bindings`, then the call's — each layer
 * normalized on its own, so the call wins a shared key over the bindings and the bindings over the
 * Scope. They are redacted as one record, so a secret key is masked whichever layer it came from. Freezing the record, its attributes and every link of its
 * error lets every sink receive the same object without one sink's writes, at any depth, changing
 * what the next one sees.
 */
function createRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | undefined,
  error: unknown,
  bindings: Attributes,
): LogRecord {
  const time = settings.clock();
  const normalized = mergeAttributes([scopeAttributes(), bindings, normalizeAttributes(attributes ?? {})]);
  const serialized = error === undefined ? undefined : serializeError(error);
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
  return freezeDeep(record);
}

/** `record` passed through `processors` in order, or `null` as soon as one of them drops it. */
function runProcessors(processors: readonly LogProcessor[], record: LogRecord): LogRecord | null {
  let current = record;
  for (const processor of processors) {
    const next = processor(current);
    if (next === null) {
      return null;
    }
    current = next;
  }
  return current;
}

/** Reports a failed `write`; a throw from the report itself is swallowed. */
function reportSinkError(settings: EmitSettings, thrown: unknown): void {
  try {
    settings.onSinkError(thrown);
  } catch {
    // Reporting a sink failure never breaks the call that emitted the record.
  }
}

/**
 * Turns one enabled Logger call into a {@link LogRecord} and writes it, with the Resource in
 * force, to every sink of `settings`. Never throws.
 *
 * `bindings` are the attributes the Logger carries from `with`, already normalized and frozen.
 * They lie over the current Scope's attributes, and the call's `attributes` win over both key by
 * key. A throw while reading the Scope leaves its attributes out rather than dropping the record.
 *
 * `error` is `undefined` when the call passed none; any other value, `null` included, is a thrown
 * value and is serialized into the record's `error`. With no sink configured nothing else is read:
 * neither the clock, nor the Scope, nor the attributes, nor the error.
 *
 * Building the record — the clock, normalizing the attributes, serializing the error, redacting
 * them, running the global processors and asking for the Resource — runs inside one guard. A throw
 * there drops the record: no sink receives it, the caller does not see the throw, and nothing is
 * reported, since `onSinkError` is for sink failures alone. A `null` from a global processor drops
 * the record for every sink, and the Resource is not asked for.
 *
 * Each sink then runs its own processors on what the global ones returned, in a guard of their
 * own: a throw or a `null` there drops the record for that sink alone, unreported. Each `write`
 * runs in its own guard that reports to `onSinkError`, so every sink is tried. Whatever `write`
 * returns is ignored: a returned promise is neither awaited nor observed, and a rejection of it is
 * the sink's own to handle.
 */
export function emitRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | undefined,
  error: unknown,
  bindings: Attributes = {},
): void {
  const { sinks } = settings;
  if (sinks.length === 0) {
    return;
  }

  let record: LogRecord | null;
  let resource: Resource;
  try {
    record = runProcessors(settings.processors, createRecord(settings, level, category, message, attributes, error, bindings));
    if (record === null) {
      return;
    }
    resource = settings.resource();
  } catch {
    return;
  }

  for (const { sink, processors } of sinks) {
    let delivered: LogRecord | null;
    try {
      delivered = runProcessors(processors, record);
    } catch {
      continue;
    }
    if (delivered === null) {
      continue;
    }
    try {
      sink.write(delivered, resource);
    } catch (thrown) {
      reportSinkError(settings, thrown);
    }
  }
}
