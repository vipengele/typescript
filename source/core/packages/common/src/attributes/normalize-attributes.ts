import type { AttributeValue, Attributes, AttributesInput } from "./attribute-value";

/** Options accepted by {@link normalizeAttributes}. */
export interface NormalizeAttributesOptions {
  /**
   * Levels of nesting kept, the input record itself counting as the first. A container deeper
   * than this is replaced whole by `"[Truncated]"`. Defaults to 6.
   */
  readonly maxDepth?: number;
  /**
   * Entries kept per object and items kept per array; the rest are summarised by one
   * `"[Truncated: N more]"` marker. Defaults to 100.
   */
  readonly maxBreadth?: number;
  /**
   * Characters kept per string before it is cut and suffixed with `"…[truncated]"`. Defaults
   * to 8192.
   */
  readonly maxStringLength?: number;
}

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_BREADTH = 100;
const DEFAULT_MAX_STRING_LENGTH = 8192;

const CIRCULAR = "[Circular]";
const TRUNCATED = "[Truncated]";
const UNREADABLE = "[Unreadable]";
// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const STRING_TRUNCATION_SUFFIX = "…[truncated]";
const BREADTH_TRUNCATION_KEY = "…";

interface State {
  readonly maxDepth: number;
  readonly maxBreadth: number;
  readonly maxStringLength: number;
  /**
   * The objects on the path from the root to the value being normalized. An object is added
   * before its children are walked and removed once they are done, so only a true ancestor
   * reads as `"[Circular]"` — the same object appearing twice as siblings normalizes in full
   * both times.
   */
  readonly visited: WeakSet<object>;
}

/**
 * A getter or a `Proxy` trap can throw on any property access. Reading every value through
 * here confines that failure to the one property it came from, rather than losing the whole
 * record to it. A read that throws yields `fallback` — `"[Unreadable]"` for a value that
 * appears in the result, `null` for a name the caller substitutes its own default for.
 */
function readProperty(target: object, key: PropertyKey, fallback: unknown = UNREADABLE): unknown {
  try {
    return (target as Record<PropertyKey, unknown>)[key];
  } catch {
    return fallback;
  }
}

function truncateString(value: string, state: State): string {
  return value.length > state.maxStringLength ? `${value.slice(0, state.maxStringLength)}${STRING_TRUNCATION_SUFFIX}` : value;
}

function breadthMarker(total: number, state: State): string {
  return `[Truncated: ${total - state.maxBreadth} more]`;
}

/**
 * A retained caller key can legitimately be `"…"` (or a generated `"…#1"`), and appending the
 * breadth marker under that same key would silently overwrite it once `Object.fromEntries`
 * collapses the duplicate. Raising a `#<n>` suffix until the candidate isn't in `used` keeps the
 * marker from ever colliding with a key it is meant to summarise alongside.
 */
function breadthMarkerKey(used: ReadonlySet<string>): string {
  let key = BREADTH_TRUNCATION_KEY;
  for (let suffix = 1; used.has(key); suffix++) {
    key = `${BREADTH_TRUNCATION_KEY}#${suffix}`;
  }
  return key;
}

function describeFunction(fn: object): string {
  const name = readProperty(fn, "name", null);
  return `[Function: ${typeof name === "string" && name !== "" ? name : "anonymous"}]`;
}

/**
 * Walks own enumerable string keys only. `Object.keys` lists names without invoking getters, so
 * each value is then read on its own — `Object.entries` would call every getter up front and
 * one throwing getter would abort the whole object. An `undefined` value drops its key, as
 * `JSON.stringify` does.
 */
function normalizeRecord(record: object, depth: number, state: State): { readonly [key: string]: AttributeValue } {
  const keys = Object.keys(record);
  const entries: [string, AttributeValue][] = [];

  for (const key of keys.slice(0, state.maxBreadth)) {
    const value = readProperty(record, key);
    if (value !== undefined) {
      entries.push([key, normalizeValue(value, depth + 1, state)]);
    }
  }

  if (keys.length > state.maxBreadth) {
    const used = new Set(entries.map(([key]) => key));
    entries.push([breadthMarkerKey(used), breadthMarker(keys.length, state)]);
  }

  // `Object.fromEntries` defines each key as an own data property, so a `__proto__` key in the
  // input stays a key instead of replacing the result's prototype.
  return Object.fromEntries(entries);
}

/** An `undefined` element becomes `null`: an array cannot have a hole in JSON. */
function normalizeArray(array: readonly unknown[], depth: number, state: State): AttributeValue[] {
  const kept = Math.min(array.length, state.maxBreadth);
  const result: AttributeValue[] = [];

  for (let index = 0; index < kept; index++) {
    result.push(normalizeValue(readProperty(array, index), depth + 1, state));
  }

  if (array.length > state.maxBreadth) {
    result.push(breadthMarker(array.length, state));
  }

  return result;
}

/**
 * A `Map` key is rarely a string, and `Object.fromEntries` coerces every key to one with
 * `String()` — two distinct object keys with no custom `toString` both become
 * `"[object Object]"` and silently overwrite one another. Stringifying the key here the same
 * way, then raising a `#<n>` suffix until the result is a key nothing has been emitted under
 * yet, keeps every entry instead of losing one to a collision `Object.fromEntries` would not
 * have reported — including a collision against a literal key that already looks generated.
 */
function normalizeMap(map: ReadonlyMap<unknown, unknown>, depth: number, state: State): { readonly [key: string]: AttributeValue } {
  const entries: [string, AttributeValue][] = [];
  const emitted = new Set<string>();
  let index = 0;

  for (const [key, value] of map) {
    if (index >= state.maxBreadth) {
      break;
    }
    index++;

    if (value === undefined) {
      continue;
    }

    const stringKey = typeof key === "string" ? key : String(key);
    let outputKey = stringKey;
    for (let suffix = 1; emitted.has(outputKey); suffix++) {
      outputKey = `${stringKey}#${suffix}`;
    }
    emitted.add(outputKey);

    entries.push([outputKey, normalizeValue(value, depth + 1, state)]);
  }

  if (map.size > state.maxBreadth) {
    entries.push([breadthMarkerKey(emitted), breadthMarker(map.size, state)]);
  }

  return Object.fromEntries(entries);
}

/**
 * The error's own identity only. Its `cause` and `errors` are not followed: an attribute value
 * is context, and a chain of errors is the reporter's concern, not the normalizer's. A `message`
 * that is not a string reads as `"[Unreadable]"`.
 */
function normalizeError(error: Error, state: State): { readonly [key: string]: AttributeValue } {
  const errorClass = readProperty(error, "constructor");
  const name = typeof errorClass === "function" ? readProperty(errorClass, "name", null) : undefined;
  const message = readProperty(error, "message");
  const stack = readProperty(error, "stack");

  const shape: Record<string, AttributeValue> = {
    type: typeof name === "string" && name !== "" ? name : "Error",
    message: typeof message === "string" ? truncateString(message, state) : UNREADABLE,
  };
  if (typeof stack === "string") {
    shape.stack = truncateString(stack, state);
  }
  return shape;
}

function normalizeContainer(value: object, depth: number, state: State): AttributeValue {
  if (Array.isArray(value)) {
    return normalizeArray(value, depth, state);
  }
  if (value instanceof Set) {
    return normalizeArray(Array.from(value), depth, state);
  }
  if (value instanceof Map) {
    return normalizeMap(value, depth, state);
  }
  if (value instanceof Error) {
    return normalizeError(value, state);
  }
  return normalizeRecord(value, depth, state);
}

/**
 * `toJSON()` is called at most once per value, as `JSON.stringify` does: its result is
 * normalized with `honorToJSON` off, so a `toJSON` that returns another object with a `toJSON`
 * cannot recurse forever. A `toJSON` that throws, or returns the value itself, is ignored and
 * the value is walked as a plain object.
 *
 * Anything else that throws — a revoked `Proxy`, a trap on `Object.keys` or `instanceof` —
 * makes the whole value `"[Unreadable]"`.
 */
function normalizeObject(value: object, depth: number, state: State, honorToJSON: boolean): AttributeValue {
  if (state.visited.has(value)) {
    return CIRCULAR;
  }

  state.visited.add(value);
  try {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    }

    if (honorToJSON) {
      const toJSON = readProperty(value, "toJSON");
      if (typeof toJSON === "function") {
        let replacement: unknown = value;
        try {
          replacement = toJSON.call(value);
        } catch {
          // Walked as a plain object below.
        }
        if (replacement !== value) {
          return normalizeValue(replacement, depth, state, false);
        }
      }
    }

    if (depth > state.maxDepth) {
      return TRUNCATED;
    }

    return normalizeContainer(value, depth, state);
  } catch {
    return UNREADABLE;
  } finally {
    state.visited.delete(value);
  }
}

function normalizeValue(value: unknown, depth: number, state: State, honorToJSON = true): AttributeValue {
  switch (typeof value) {
    case "string":
      return truncateString(value, state);
    case "number":
      // `NaN`/`Infinity`/`-Infinity` survive unchanged in memory but become `null` under
      // `JSON.stringify`, so a JSON sink and an in-memory one would otherwise see different
      // values for the same attribute. A stable string keeps every sink in agreement.
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return truncateString(`${value}n`, state);
    case "symbol":
      return truncateString(value.toString(), state);
    case "function":
      return truncateString(describeFunction(value), state);
    case "object":
      return value === null ? null : normalizeObject(value, depth, state, honorToJSON);
    default:
      // `undefined`: an array element or a `toJSON()` result, never an object property.
      return null;
  }
}

/**
 * Brings arbitrary caller data into the {@link AttributeValue} shape every sink and transport
 * can serialise, and never throws while doing it.
 *
 * `Date` becomes its ISO string, `Map` a plain object, `Set` an array, `bigint` a `"<n>n"`
 * string, a function or symbol its string form, and a nested `Error` its local
 * `{ type, message, stack? }`. A value's own `toJSON()` is honored before any of the generic
 * object handling. A property that throws when read becomes `"[Unreadable]"`, an object that
 * contains itself becomes `"[Circular]"` where it recurs, and the depth, breadth and string
 * length limits in {@link NormalizeAttributesOptions} bound the size of the result.
 *
 * An input whose keys cannot even be listed — a revoked `Proxy` — normalizes to `{}`.
 */
export function normalizeAttributes(input: AttributesInput, options?: NormalizeAttributesOptions): Attributes {
  const state: State = {
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxBreadth: options?.maxBreadth ?? DEFAULT_MAX_BREADTH,
    maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    visited: new WeakSet([input]),
  };

  try {
    return normalizeRecord(input, 1, state);
  } catch {
    return {};
  }
}
