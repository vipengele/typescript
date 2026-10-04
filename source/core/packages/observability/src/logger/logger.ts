import type { Level } from "@vipengele/ts-core-common";
import { validateCategory } from "./categories";
import { enabled, type LevelEntry } from "./levels";

/** The entry that governs a category, read from wherever a Logger's configuration lives. */
export type LevelResolver = (category: string) => LevelEntry;

/**
 * A category-scoped handle on a Logger Provider's configuration. It holds its category and the
 * provider's resolver, never a copy of the configuration, so a level changed after the Logger was
 * created — by `configure`, `override`, `reset` or another copy of the package — governs it on the
 * next call.
 */
export interface Logger {
  /** The Category this Logger writes under. */
  readonly category: string;

  /** Whether a record at `level` passes the threshold that governs this Logger's category right now. */
  enabled(level: Level): boolean;
}

/**
 * A {@link Logger} for `category` that asks `resolve` for its threshold on every call. Throws a
 * `LoggingConfigError` when `category` is not a Category; the root `*` is a level-table key, not a
 * Logger's category.
 */
export function createLogger(category: string, resolve: LevelResolver): Logger {
  const validated = validateCategory(category);
  return Object.freeze({
    category: validated,
    enabled(level: Level): boolean {
      return enabled(resolve(validated), level);
    },
  });
}
