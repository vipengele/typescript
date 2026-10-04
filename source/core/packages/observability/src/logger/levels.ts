import { isLevel, type Level, SEVERITY_NUMBERS, type Threshold } from "@vipengele/ts-core-common";
import { governingKeys } from "./categories";
import { LoggingConfigError } from "./config-error";

/**
 * The severity `off` carries: one above OpenTelemetry's highest severity number (24), so it sits
 * above every level, including any level a later version of this package adds inside that range.
 */
export const OFF_SEVERITY = 25;

/**
 * One category's threshold in a level table. `severity` travels with `level` so a copy of this
 * package that does not know the level's name can still place it against the levels it does
 * know. A plain object, so another package version reads it without sharing a class.
 */
export interface LevelEntry {
  readonly level: Threshold;
  readonly severity: number;
}

/**
 * Category key (a Category or the root `*`) to the threshold that governs it. A table is never
 * mutated once a Logger can read it, only replaced by a new object: resolution is cached by the
 * table's identity. It may be a plain object or a prototype-less one; lookups use own properties
 * only.
 */
export type LevelTable = Readonly<Record<string, LevelEntry>>;

/**
 * Whether `value` is a `Threshold`: one of the six levels, or `"off"`. Own-property lookup, so
 * inherited names such as `"constructor"` and `"__proto__"` are not thresholds.
 */
export function isThreshold(value: unknown): value is Threshold {
  return value === "off" || isLevel(value);
}

/** Returns `value` when it is a `Threshold`, and throws a `LoggingConfigError` otherwise. */
export function validateThreshold(value: unknown): Threshold {
  if (!isThreshold(value)) {
    const shown = typeof value === "string" ? JSON.stringify(value) : `of type ${value === null ? "null" : typeof value}`;
    throw new LoggingConfigError(`Invalid logger level ${shown}: expected one of trace, debug, info, warn, error, fatal or off.`);
  }
  return value;
}

/** The severity number of `threshold`; `off` is {@link OFF_SEVERITY}, above every level. */
export function severityOf(threshold: Threshold): number {
  return threshold === "off" ? OFF_SEVERITY : SEVERITY_NUMBERS[threshold];
}

/** The level-table entry for `threshold`. */
export function entryFor(threshold: Threshold): LevelEntry {
  return { level: threshold, severity: severityOf(threshold) };
}

/**
 * Whether a record at `level` passes `entry`: its severity is at least the entry's. An `off`
 * entry enables nothing. Compares the carried `severity`, never the level name, so an entry
 * whose name this copy does not know still compares correctly.
 */
export function enabled(entry: LevelEntry, level: Level): boolean {
  return SEVERITY_NUMBERS[level] >= entry.severity;
}

/**
 * Memoized resolutions per table. Keyed by table identity, which is sound only because a table is
 * replaced rather than mutated; a replaced table's memo is collected with it. Each copy of this
 * package keeps its own memo: it holds nothing another copy needs to agree on.
 */
const resolutions = new WeakMap<LevelTable, Map<string, LevelEntry | undefined>>();

/**
 * The entry that governs `category` in `table`: the entry of the longest key that equals
 * `category` or is a prefix of it ending at a `.` boundary, else the root `*`'s entry, else
 * `undefined` when the table has no root. Case-sensitive. Only own properties count, so
 * `constructor` or `__proto__` never resolves through the table's prototype chain.
 */
export function resolveEntry(table: LevelTable, category: string): LevelEntry | undefined {
  let memo = resolutions.get(table);
  if (memo === undefined) {
    memo = new Map();
    resolutions.set(table, memo);
  } else if (memo.has(category)) {
    return memo.get(category);
  }
  let resolved: LevelEntry | undefined;
  for (const key of governingKeys(category)) {
    if (Object.hasOwn(table, key)) {
      resolved = table[key];
      break;
    }
  }
  memo.set(category, resolved);
  return resolved;
}
