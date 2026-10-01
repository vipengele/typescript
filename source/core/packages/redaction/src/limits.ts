/**
 * The bounds on a redaction walk, and the markers a breach leaves behind. The values match
 * `toJsonSafe`'s in `@vipengele/ts-core-common`, so a value bounded by either reads the same; they
 * are repeated here rather than imported because this package has no runtime dependencies.
 */

/** Levels of nesting kept by default, the input itself counting as the first. */
export const DEFAULT_MAX_DEPTH = 6;
/** Entries kept per container by default. */
export const DEFAULT_MAX_BREADTH = 100;
/** Characters kept per string by default. */
export const DEFAULT_MAX_STRING_LENGTH = 8192;

/** What a container deeper than `maxDepth` is replaced with. */
export const TRUNCATED = "[Truncated]";
// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
export const STRING_TRUNCATION_SUFFIX = "…[truncated]";
/** The key an object's or `Map`'s breadth marker is stored under, unless a kept key already holds it. */
export const BREADTH_TRUNCATION_KEY = "…";

/** The limits a caller may set; each one left out takes its default. */
export interface LimitOptions {
  readonly maxDepth?: number;
  readonly maxBreadth?: number;
  readonly maxStringLength?: number;
}

/** Every limit with its default filled in. */
export interface Limits {
  readonly maxDepth: number;
  readonly maxBreadth: number;
  readonly maxStringLength: number;
}

/**
 * Fills in each limit the caller left out. Values are not validated: every limit is applied by
 * a `>` comparison, so `NaN` compares false everywhere and disables its limit, and `Infinity`
 * never trips one.
 */
export function resolveLimits(options?: LimitOptions): Limits {
  return {
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxBreadth: options?.maxBreadth ?? DEFAULT_MAX_BREADTH,
    maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
  };
}

/** Cuts `value` to `maxStringLength` UTF-16 code units and appends the suffix, which is not counted. */
export function truncateString(value: string, limits: Limits): string {
  return value.length > limits.maxStringLength ? `${value.slice(0, limits.maxStringLength)}${STRING_TRUNCATION_SUFFIX}` : value;
}

/** Whether a container of `total` entries holds more than `maxBreadth` of them. */
export function exceedsBreadth(total: number, limits: Limits): boolean {
  return total > limits.maxBreadth;
}

/**
 * The first `maxBreadth` of `items`, or `items` itself when it fits. Slicing only once the limit is
 * exceeded keeps a `NaN` limit from emptying the container, and leaves an array's holes in place.
 */
export function keepWithinBreadth<T>(items: readonly T[], limits: Limits): readonly T[] {
  return exceedsBreadth(items.length, limits) ? items.slice(0, limits.maxBreadth) : items;
}

/** The marker standing in for the entries past `maxBreadth` in a container of `total` entries. */
export function breadthMarker(total: number, limits: Limits): string {
  return `[Truncated: ${total - limits.maxBreadth} more]`;
}

/**
 * A kept key can itself be `"…"` (or a generated `"…#1"`), and storing the breadth marker under it
 * would overwrite that entry. Raising a `#<n>` suffix until the candidate is not in `used` keeps the
 * marker from ever replacing a key it summarises alongside.
 */
export function breadthMarkerKey(used: ReadonlySet<string>): string {
  let key = BREADTH_TRUNCATION_KEY;
  for (let suffix = 1; used.has(key); suffix++) {
    key = `${BREADTH_TRUNCATION_KEY}#${suffix}`;
  }
  return key;
}
