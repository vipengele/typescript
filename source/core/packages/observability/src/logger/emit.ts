import {
  type Attributes,
  type AttributesInput,
  type Level,
  normalizeAttributes,
  type SerializedError,
  serializeError,
} from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, type RedactOptions, redact } from "@vipengele/ts-core-redaction";
import type { EmitSettings, LogRecord } from "./record";

/**
 * `normalizeAttributes` and `serializeError` already bound what they return, and their own
 * markers — a `"…"` breadth key, a `"…[truncated]"` suffix — sit right at those bounds. Redacting
 * under the default limits a second time would cut the markers themselves, so the pass runs
 * unbounded over input that is bounded and acyclic already.
 */
const UNBOUNDED: RedactOptions = {
  maxDepth: Number.POSITIVE_INFINITY,
  maxBreadth: Number.POSITIVE_INFINITY,
  maxStringLength: Number.POSITIVE_INFINITY,
};

/**
 * `redact` returns `unknown`. It copies a plain object as a plain object and only ever replaces
 * values, never keys, so the copy of an `Attributes` has the keys it was given, each holding its
 * value or the policy's replacement — a string unless the policy supplies a replacement function.
 */
function redactAttributes<T extends Attributes>(attributes: T, policy: RedactionPolicy): T {
  return redact(attributes, policy, UNBOUNDED) as T;
}

/**
 * Stands in for the `message` of a synthetic link that reads as structured text but does not
 * parse — a JSON form `serializeError` cut at its string length bound, or a thrown string that
 * merely starts like one. Its keys cannot be told from its values, so none of it is kept.
 */
const UNSCANNABLE = "[REDACTED: unparseable structured value]";

/**
 * The `message` of a synthetic link: the thrown value as it is when it was a string, its JSON
 * text otherwise. Text that opens an object or an array once leading whitespace and a byte order
 * mark are skipped — a response body read as text often starts with either — is parsed without
 * them, redacted and written back as JSON, or replaced whole by {@link UNSCANNABLE} when it does
 * not parse; any other text — a thrown string, number, boolean or `null` — has no keys a policy
 * could match and is kept.
 */
function redactSyntheticMessage(message: string, policy: RedactionPolicy): string {
  // `trimStart` strips U+FEFF along with whitespace, and `JSON.parse` rejects a leading U+FEFF.
  const text = message.trimStart();
  if (!(text.startsWith("{") || text.startsWith("["))) {
    return message;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNSCANNABLE;
  }
  return JSON.stringify(redact(parsed, policy, UNBOUNDED));
}

/**
 * A copy of `error` whose `data` and `code`, and those of every `cause` and `errors` entry beneath
 * it, are redacted, as is the `message` of every synthetic link: a thrown value that is not an
 * `Error` carries its fields in that message, not in `data`. `code` is passed through the policy
 * under the key `code`, as it is in `data`, so a policy matching that key leaves it in clear
 * nowhere. The `message` and `stack` of a real error are kept as they are.
 */
function redactError(error: SerializedError, policy: RedactionPolicy): SerializedError {
  const redacted: SerializedError = { ...error };
  if (error.code !== undefined) {
    redacted.code = redactAttributes({ code: error.code }, policy).code;
  }
  if (error.synthetic === true) {
    redacted.message = redactSyntheticMessage(error.message, policy);
  }
  if (error.data !== undefined) {
    redacted.data = redactAttributes(error.data, policy);
  }
  if (error.cause !== undefined) {
    redacted.cause = redactError(error.cause, policy);
  }
  if (error.errors !== undefined) {
    redacted.errors = error.errors.map((entry) => redactError(entry, policy));
  }
  return redacted;
}

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
