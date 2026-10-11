import { type Attributes, type AttributesInput, type Level, normalizeAttributes } from "@vipengele/ts-core-common";
import { mergeAttributes } from "../merge-attributes";
import { validateCategory } from "./categories";
import { emitRecord, freezeDeep } from "./emit";
import { enabled, type LevelEntry } from "./levels";
import type { EmitSettings } from "./record";

/** The entry that governs a category, read from wherever a Logger's configuration lives. */
export type LevelResolver = (category: string) => LevelEntry;

/**
 * A category-scoped handle on a Logger Provider's configuration. It holds its category and the
 * provider's resolver, never a copy of the configuration, so a level changed after the Logger was
 * created — by `configure`, `override`, `reset` or another copy of the package — governs it on the
 * next call.
 *
 * Each emit method checks the level first: at a disabled level it reads nothing else, not even the
 * clock. An enabled call builds one record and writes it to every sink in force; it returns
 * nothing and never throws, whatever a sink, the clock or the redaction policy does. The methods do
 * not depend on `this`, so a method taken off the Logger works on its own.
 *
 * `error` is a thrown value of any kind; `undefined` means the call has none, while any other
 * value, `null` included, is serialized into the record with its whole `cause`/`errors` chain.
 */
export interface Logger {
  /** The Category this Logger writes under. */
  readonly category: string;

  /** Whether a record at `level` passes the threshold that governs this Logger's category right now. */
  enabled(level: Level): boolean;

  /**
   * A new, frozen Logger for the same category whose every record carries `attributes`
   * (ADR-0006). The bindings are lexical: they follow the returned Logger, not the call chain, and
   * never touch the Scope. They are normalized and deeply frozen here, so changing the object
   * passed in afterwards changes no record; redaction still runs on each record when it is
   * emitted. A key a call passes wins over a bound one, and a nested `with` wins over the Logger
   * it was called on, which keeps its own bindings unchanged. The returned Logger shares this
   * one's level resolver and emit settings, so a level or sink configured later governs it too.
   * `with` with no attributes returns this Logger itself.
   */
  with(attributes: AttributesInput): Logger;

  trace(message: string, attributes?: AttributesInput): void;
  debug(message: string, attributes?: AttributesInput): void;
  info(message: string, attributes?: AttributesInput): void;
  warn(message: string, error?: unknown, attributes?: AttributesInput): void;
  error(message: string, error?: unknown, attributes?: AttributesInput): void;
  fatal(message: string, error?: unknown, attributes?: AttributesInput): void;
}

/**
 * A {@link Logger} for `category` that asks `resolve` for its threshold on every call, and `emit`
 * for what it emits through on every call that passes it. Throws a `LoggingConfigError` when
 * `category` is not a Category; the root `*` is a level-table key, not a Logger's category.
 */
export function createLogger(category: string, resolve: LevelResolver, emit: () => EmitSettings): Logger {
  return bindLogger(validateCategory(category), resolve, emit, {});
}

/** The {@link Logger} for an already validated category, carrying `bindings` on every record. */
function bindLogger(category: string, resolve: LevelResolver, emit: () => EmitSettings, bindings: Attributes): Logger {
  function log(level: Level, message: string, attributes: AttributesInput | undefined, error: unknown): void {
    if (enabled(resolve(category), level)) {
      emitRecord(emit(), level, category, message, attributes, error, bindings);
    }
  }

  const logger: Logger = Object.freeze({
    category,
    enabled(level: Level): boolean {
      return enabled(resolve(category), level);
    },
    with(attributes: AttributesInput): Logger {
      const added = normalizeAttributes(attributes);
      if (Object.keys(added).length === 0) {
        return logger;
      }
      return bindLogger(category, resolve, emit, freezeDeep(mergeAttributes([bindings, added])));
    },
    trace(message: string, attributes?: AttributesInput): void {
      log("trace", message, attributes, undefined);
    },
    debug(message: string, attributes?: AttributesInput): void {
      log("debug", message, attributes, undefined);
    },
    info(message: string, attributes?: AttributesInput): void {
      log("info", message, attributes, undefined);
    },
    warn(message: string, error?: unknown, attributes?: AttributesInput): void {
      log("warn", message, attributes, error);
    },
    error(message: string, error?: unknown, attributes?: AttributesInput): void {
      log("error", message, attributes, error);
    },
    fatal(message: string, error?: unknown, attributes?: AttributesInput): void {
      log("fatal", message, attributes, error);
    },
  });
  return logger;
}
