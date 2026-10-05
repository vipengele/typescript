import type { Attributes, SerializedError } from "@vipengele/ts-core-common";
import { type RedactionPolicy, type RedactOptions, redact } from "@vipengele/ts-core-redaction";

/**
 * How records are redacted: a `RedactionPolicy` from `@vipengele/ts-core-redaction` (the
 * `secretKeys` preset, a `composePolicies` result, or a policy of the caller's own), or `null`
 * for no redaction. The setting holds the policy only; the package never reads the preset itself
 * at module scope, so a consumer that disables redaction pays nothing for it (ADR-0011).
 *
 * A policy is applied to `attributes` and to every link of the serialized error chain (`error`,
 * and each `cause` and `errors` entry beneath it), when the record is created and before any sink
 * sees it: to the `data` and `code` of a link for an `Error`, `code` read under the key `code`,
 * and to the fields of a structured thrown value that is not an `Error`, carried as JSON text in
 * its synthetic link's `message`; a thrown string is read the same way when it opens with `{` or
 * `[` after any leading whitespace and byte order mark. That text is replaced whole when it does
 * not parse, as when it was cut at the serialization length bound.
 * The record's `message`, and the `message` and `stack` of an `Error`, are not scanned: a secret
 * interpolated into a message is the caller's to keep out.
 */
export type RedactionSetting = RedactionPolicy | null;

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
export function redactAttributes<T extends Attributes>(attributes: T, policy: RedactionPolicy): T {
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
 * nowhere. The `message` and `stack` of a real error, and any other field of a link — the parsed
 * `frames` of an exception record among them — are kept as they are.
 */
export function redactError<T extends SerializedError & { cause?: T; errors?: T[] }>(error: T, policy: RedactionPolicy): T {
  const redacted: T = { ...error };
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
    // `errors` is `SerializedError[] & T[]`, and `map` on it would read its entries as the former.
    const entries: T[] = error.errors;
    redacted.errors = entries.map((entry) => redactError(entry, policy));
  }
  return redacted;
}
