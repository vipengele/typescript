import { makeRecordJsonSafe } from "../serialization/engine";
import type { Attributes, AttributesInput } from "./attribute-value";

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
 * The input record is always walked as a record: its own `toJSON()` is not called. An input
 * whose keys cannot even be listed — a revoked `Proxy` — normalizes to `{}`.
 */
export function normalizeAttributes(input: AttributesInput, options?: NormalizeAttributesOptions): Attributes {
  return makeRecordJsonSafe(input, options);
}
