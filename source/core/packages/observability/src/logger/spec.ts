import type { Threshold } from "@vipengele/ts-core-common";
import { isCategoryKey } from "./categories";
import { isThreshold } from "./levels";

/**
 * The outcome of {@link parseSpec}. `levels` is a prototype-less object mapping each category key
 * (a Category or the root `*`) to its `Threshold`, so a category named `__proto__` is an ordinary
 * own key and plain assignment cannot reach `Object.prototype`. `issues` holds one human-readable
 * string per skipped or overridden entry, each quoting the entry it describes; it is empty when
 * the spec was clean.
 */
export interface ParsedSpec {
  readonly levels: Readonly<Record<string, Threshold>>;
  readonly issues: readonly string[];
}

/**
 * Parses a level spec of the form `category:level,category:level`, where a category is a Category
 * or the root `*` and a level is a `Threshold` (`*:warn,react:debug`). Whitespace around entries
 * and around either side of the `:` is ignored, and an empty entry (an empty spec, a trailing
 * comma) is ignored without an issue.
 *
 * An entry with no `:`, more than one `:`, an invalid category or an invalid level is skipped and
 * described in `issues`. A category that appears more than once keeps the last level, and every
 * earlier occurrence is reported as an issue. Never throws: a non-string `spec` yields no levels
 * and one issue.
 */
export function parseSpec(spec: string): ParsedSpec {
  const levels: Record<string, Threshold> = Object.create(null);
  const issues: string[] = [];
  if (typeof spec !== "string") {
    issues.push(`Level spec must be a string, received ${spec === null ? "null" : typeof spec}.`);
    return { levels, issues };
  }
  for (const raw of spec.split(",")) {
    const entry = raw.trim();
    if (entry === "") {
      continue;
    }
    const parts = entry.split(":");
    if (parts.length !== 2) {
      issues.push(`Level spec entry ${JSON.stringify(entry)} is skipped: expected "category:level" with exactly one ":".`);
      continue;
    }
    const category = (parts[0] as string).trim();
    const level = (parts[1] as string).trim();
    if (!isCategoryKey(category)) {
      issues.push(`Level spec entry ${JSON.stringify(entry)} is skipped: invalid category ${JSON.stringify(category)}.`);
      continue;
    }
    if (!isThreshold(level)) {
      issues.push(`Level spec entry ${JSON.stringify(entry)} is skipped: invalid level ${JSON.stringify(level)}.`);
      continue;
    }
    if (Object.hasOwn(levels, category)) {
      issues.push(`Level spec entry ${JSON.stringify(entry)} repeats category ${JSON.stringify(category)}: the last entry wins.`);
    }
    levels[category] = level;
  }
  return { levels, issues };
}
