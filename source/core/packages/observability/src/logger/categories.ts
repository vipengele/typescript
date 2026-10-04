import { LoggingConfigError } from "./config-error";

/**
 * The root of the category tree. It is a level-table key and a spec category, never a Logger's
 * category: it governs every category no longer key matches.
 */
export const ROOT_CATEGORY = "*";

const SEPARATOR = ".";

/** Characters a segment may not contain: `*` is the root, `:` and `,` delimit a spec string. */
const FORBIDDEN_IN_SEGMENT = /[*:,]/;

/**
 * Whether `value` is a Category: one or more non-empty segments joined by `.`, none of them
 * containing `*`, `:` or `,`. Case-sensitive. The root `*` is not a Category; see
 * {@link isCategoryKey}.
 */
export function isCategory(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return value.split(SEPARATOR).every((segment) => segment.length > 0 && !FORBIDDEN_IN_SEGMENT.test(segment));
}

/** Whether `value` may key a level table: a Category, or the root `*`. */
export function isCategoryKey(value: unknown): value is string {
  return value === ROOT_CATEGORY || isCategory(value);
}

/** Returns `value` when it is a Category, and throws a `LoggingConfigError` otherwise. */
export function validateCategory(value: unknown): string {
  if (!isCategory(value)) {
    throw new LoggingConfigError(
      `Invalid logger category ${describe(value)}: expected dot-separated non-empty segments without "*", ":" or ",".`,
    );
  }
  return value;
}

/** Returns `value` when it may key a level table, and throws a `LoggingConfigError` otherwise. */
export function validateCategoryKey(value: unknown): string {
  if (!isCategoryKey(value)) {
    throw new LoggingConfigError(
      `Invalid logger category ${describe(value)}: expected "*" or dot-separated non-empty segments without "*", ":" or ",".`,
    );
  }
  return value;
}

/**
 * The keys that govern `category`, most specific first: the category itself, each prefix ending
 * at a `.` boundary, then the root. `react.dom` yields `react.dom`, `react`, `*`; `reactive` never
 * appears among the keys of `react.x`, nor `react` among those of `reactive`. The root yields only
 * itself.
 */
export function* governingKeys(category: string): Generator<string, void, undefined> {
  let key = category;
  while (key !== ROOT_CATEGORY) {
    yield key;
    const boundary = key.lastIndexOf(SEPARATOR);
    key = boundary === -1 ? ROOT_CATEGORY : key.slice(0, boundary);
  }
  yield ROOT_CATEGORY;
}

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : `of type ${value === null ? "null" : typeof value}`;
}
