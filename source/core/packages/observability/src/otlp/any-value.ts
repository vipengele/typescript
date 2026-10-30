/**
 * An OTLP `AnyValue` in the OTLP/HTTP JSON encoding: exactly one field set, or none for an empty
 * value. A 64-bit `intValue` is a decimal string, as the JSON encoding of an `int64` requires.
 */
export type AnyValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly arrayValue: { readonly values: readonly AnyValue[] } }
  | { readonly kvlistValue: { readonly values: readonly KeyValue[] } }
  | Readonly<Record<string, never>>;

/** An OTLP `KeyValue`: one attribute, or one entry of a `kvlistValue`. */
export interface KeyValue {
  readonly key: string;
  readonly value: AnyValue;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** Stands in for an object already on the path from the root value, so a cycle ends. */
const CIRCULAR = "[Circular]";

/**
 * Encodes `value` as an OTLP {@link AnyValue}. Normalized attributes (ADR-0007) only hold strings,
 * finite numbers, booleans, `null`, arrays and plain objects; the other cases keep a hand-built
 * record from breaking the payload:
 *
 * - a safe integer is an `intValue`, any other finite number a `doubleValue`; `NaN` and the
 *   infinities, which JSON cannot carry, are a `stringValue` of their text;
 * - a `bigint` within the `int64` range is an `intValue`, outside it a `stringValue`;
 * - `null` and `undefined` are the empty value `{}`; an object entry whose value is `undefined` is
 *   left out, as `JSON.stringify` leaves it out;
 * - an array is an `arrayValue`; any other object is a `kvlistValue` of its own enumerable
 *   string-keyed entries, and an object met again inside itself is the `stringValue` `"[Circular]"`;
 * - a symbol or a function is a `stringValue` of `String(value)`.
 */
export function toAnyValue(value: unknown): AnyValue {
  return encode(value, new Set());
}

/**
 * Encodes each own enumerable entry of `attributes` as a {@link KeyValue}, in property order. An
 * entry whose value is `undefined` is left out.
 */
export function toKeyValues(attributes: Readonly<Record<string, unknown>>): KeyValue[] {
  return entries(attributes, new Set([attributes]));
}

function encode(value: unknown, path: Set<object>): AnyValue {
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { boolValue: value };
    case "number":
      return encodeNumber(value);
    case "bigint":
      return value >= INT64_MIN && value <= INT64_MAX ? { intValue: value.toString() } : { stringValue: value.toString() };
    case "object":
      return value === null ? {} : encodeObject(value, path);
    case "undefined":
      return {};
    default:
      return { stringValue: String(value) };
  }
}

function encodeNumber(value: number): AnyValue {
  if (Number.isSafeInteger(value)) {
    return { intValue: String(value) };
  }
  return Number.isFinite(value) ? { doubleValue: value } : { stringValue: String(value) };
}

function encodeObject(value: object, path: Set<object>): AnyValue {
  if (path.has(value)) {
    return { stringValue: CIRCULAR };
  }
  path.add(value);
  try {
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map((element: unknown) => encode(element, path)) } };
    }
    return { kvlistValue: { values: entries(value, path) } };
  } finally {
    path.delete(value);
  }
}

function entries(value: object, path: Set<object>): KeyValue[] {
  const result: KeyValue[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result.push({ key, value: encode(entry, path) });
    }
  }
  return result;
}
