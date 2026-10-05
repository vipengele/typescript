import { type AttributesInput, type Level, normalizeAttributes, serializeError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { redactAttributes, redactError } from "../redaction";
import type { EmitSettings, LogRecord } from "./record";

/**
 * Freezes `value` and every object and array beneath it. A record holds only JSON-safe data that
 * `normalizeAttributes`, `serializeError` and `redact` built for it, bounded and acyclic, so the
 * walk ends and never reaches an object of the caller's.
 */
function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      freezeDeep(entry);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The deeply frozen record for one call. Freezing the record, its attributes and every link of
 * its error lets every sink receive the same object without one sink's writes, at any depth,
 * changing what the next one sees.
 */
function createRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | undefined,
  error: unknown,
): LogRecord {
  const time = settings.clock();
  const normalized = normalizeAttributes(attributes ?? {});
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
 * `error` is `undefined` when the call passed none; any other value, `null` included, is a thrown
 * value and is serialized into the record's `error`. With no sink configured nothing else is read:
 * neither the clock, nor the attributes, nor the error.
 *
 * Building the record — the clock, normalizing the attributes, serializing the error, redacting
 * them, and asking for the Resource — runs inside one guard. A throw there drops the record: no
 * sink receives it, the caller does not see the throw, and nothing is reported, since
 * `onSinkError` is for sink failures alone. Each `write` then runs in its own guard that reports
 * to `onSinkError`, so every sink is tried. Whatever `write` returns is ignored: a returned
 * promise is neither awaited nor observed, and a rejection of it is the sink's own to handle.
 */
export function emitRecord(
  settings: EmitSettings,
  level: Level,
  category: string,
  message: string,
  attributes: AttributesInput | undefined,
  error: unknown,
): void {
  const { sinks } = settings;
  if (sinks.length === 0) {
    return;
  }

  let record: LogRecord;
  let resource: Resource;
  try {
    record = createRecord(settings, level, category, message, attributes, error);
    resource = settings.resource();
  } catch {
    return;
  }

  for (const sink of sinks) {
    try {
      sink.write(record, resource);
    } catch (thrown) {
      reportSinkError(settings, thrown);
    }
  }
}
