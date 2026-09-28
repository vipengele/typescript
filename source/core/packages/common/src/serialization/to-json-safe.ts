import { makeJsonSafe } from "./engine";
import type { JsonSafeValue } from "./json-safe-value";

/** Options accepted by {@link toJsonSafe}. */
export interface ToJsonSafeOptions {
  /**
   * Levels of nesting kept, the input itself counting as the first. A container deeper than
   * this is replaced whole by `"[Truncated]"`. Defaults to 6.
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

/**
 * Brings any value into the {@link JsonSafeValue} shape every sink and transport can serialise,
 * and never throws while doing it.
 *
 * `undefined` becomes `null`, `Date` its ISO string, `Map` a plain object, `Set` an array,
 * `bigint` a `"<n>n"` string, a function or symbol its string form, and an `Error` its local
 * `{ type, message, stack? }`. A value's own `toJSON()` is honored before any of the generic
 * object handling. A property that throws when read becomes `"[Unreadable]"`, an object that
 * contains itself becomes `"[Circular]"` where it recurs, and the depth, breadth and string
 * length limits in {@link ToJsonSafeOptions} bound the size of the result.
 *
 * A value that cannot even be inspected — a revoked `Proxy` — becomes `"[Unreadable]"`.
 */
export function toJsonSafe(value: unknown, options?: ToJsonSafeOptions): JsonSafeValue {
  return makeJsonSafe(value, options);
}
