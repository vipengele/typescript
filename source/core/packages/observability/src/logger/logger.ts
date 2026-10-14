import { type Attributes, type AttributesInput, type Level, normalizeAttributes } from "@vipengele/ts-core-common";
import { mergeAttributes } from "../merge-attributes";
import { validateCategory } from "./categories";
import { type BindingLayer, emitRecord, evaluateAttributes, freezeDeep } from "./emit";
import { enabled, type LevelEntry } from "./levels";
import type { EmitSettings } from "./record";

/**
 * Attributes computed only when a record is written. Given to an emit method, it runs once per
 * record that passes the level check and has a sink to go to, never at a disabled level; given to
 * `with`, once per bound Logger. A throw from it, or a result that is not a plain record, gives an
 * empty record in place of its attributes, and the record is still written.
 */
export type AttributesThunk = () => AttributesInput;

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
 * value, `null` included, is serialized into the record with its whole `cause`/`errors` chain. A
 * function passed as `error` is an error value too, never an {@link AttributesThunk}: only the
 * `attributes` argument is read as a thunk.
 *
 * `attributes` given as an {@link AttributesThunk} runs after the level check and the sink check,
 * once per record however many sinks receive it, and before normalization and redaction, so a
 * secret key it returns is redacted like any other. A thunk that logs from inside itself sees an
 * empty record for its own layer.
 */
export interface Logger {
  /** The Category this Logger writes under. */
  readonly category: string;

  /** Whether a record at `level` passes the threshold that governs this Logger's category right now. */
  enabled(level: Level): boolean;

  /**
   * A new, frozen Logger for the same category whose every record carries `attributes`
   * (ADR-0006). The bindings are lexical: they follow the returned Logger, not the call chain, and
   * never touch the Scope. Static attributes are normalized and deeply frozen here, so changing the
   * object passed in afterwards changes no record; redaction still runs on each record when it is
   * emitted. A key a call passes wins over a bound one, and a nested `with` wins over the Logger
   * it was called on, which keeps its own bindings unchanged. The returned Logger shares this
   * one's level resolver and emit settings, so a level or sink configured later governs it too.
   * `with` with an empty record returns this Logger itself.
   *
   * Given an {@link AttributesThunk}, `with` always returns a new Logger and runs nothing. The
   * thunk runs at the returned Logger's first record that passes the level check and has a sink;
   * its result is normalized, frozen and reused for every later record. A throw leaves the binding
   * empty for that record and is not kept, so the next record runs the thunk again. A Logger made
   * by `with` on the returned one carries the value when the returned Logger has already evaluated
   * the thunk, and otherwise runs the thunk itself, at its own first record, so the two may hold
   * different values. A key bound by a later `with` wins over the same key from an earlier thunk. The
   * first record fixes the value, so a thunk that reads ambient context such as the Scope captures
   * the context of that record alone; a value that should follow each record belongs in the Scope.
   */
  with(attributes: AttributesInput | AttributesThunk): Logger;

  trace(message: string, attributes?: AttributesInput | AttributesThunk): void;
  debug(message: string, attributes?: AttributesInput | AttributesThunk): void;
  info(message: string, attributes?: AttributesInput | AttributesThunk): void;
  warn(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void;
  error(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void;
  fatal(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void;
}

/**
 * A {@link Logger} for `category` that asks `resolve` for its threshold on every call, and `emit`
 * for what it emits through on every call that passes it. Throws a `LoggingConfigError` when
 * `category` is not a Category; the root `*` is a level-table key, not a Logger's category.
 */
export function createLogger(category: string, resolve: LevelResolver, emit: () => EmitSettings): Logger {
  return bindLogger(validateCategory(category), resolve, emit, []);
}

/** One layer of a Logger's bindings, and what a Logger made by `with` on it carries instead. */
interface Layer extends BindingLayer {
  /** The attributes every read returns, or `undefined` for a layer whose read may still change. */
  readonly fixed: Attributes | undefined;
  /** The layer a Logger made by `with` on this one carries in its place. */
  inherit(): Layer;
}

/** A layer whose attributes are fixed; a child carries it as it is. */
function fixedLayer(attributes: Attributes): Layer {
  const layer: Layer = {
    fixed: attributes,
    read: () => attributes,
    inherit: () => layer,
  };
  return layer;
}

const EMPTY: Attributes = Object.freeze({});

/**
 * A layer that runs `thunk` at its first read and keeps the frozen result. A read whose run throws,
 * or comes while another thunk is running, gives an empty record and keeps nothing, so the next
 * read runs `thunk` again. A child carries the kept result once there is one, and a fresh layer for
 * the same thunk until then.
 */
function lazyLayer(thunk: AttributesThunk): Layer {
  let resolved: Attributes | undefined;
  return {
    fixed: undefined,
    read(): Attributes {
      if (resolved === undefined) {
        const value = evaluateAttributes(thunk);
        if (value === undefined) {
          return EMPTY;
        }
        resolved = freezeDeep(value);
      }
      return resolved;
    },
    inherit: () => (resolved === undefined ? lazyLayer(thunk) : fixedLayer(resolved)),
  };
}

/**
 * The layers a Logger made by `with` carries: each of `bindings` as it inherits it, then `added`.
 * Static attributes following a fixed layer merge into it, the later key winning, so a chain of
 * static `with` calls reads one layer per record however long it is. A lazy layer always stays its
 * own entry, so attributes bound after it still win over whatever its thunk returns.
 */
function childBindings(bindings: readonly Layer[], added: Layer): Layer[] {
  const inherited = bindings.map((layer) => layer.inherit());
  const previous = inherited.at(-1)?.fixed;
  if (added.fixed === undefined || previous === undefined) {
    return [...inherited, added];
  }
  return [...inherited.slice(0, -1), fixedLayer(freezeDeep(mergeAttributes([previous, added.fixed])))];
}

/** The {@link Logger} for an already validated category, carrying `bindings` on every record. */
function bindLogger(category: string, resolve: LevelResolver, emit: () => EmitSettings, bindings: readonly Layer[]): Logger {
  function log(level: Level, message: string, attributes: AttributesInput | AttributesThunk | undefined, error: unknown): void {
    if (enabled(resolve(category), level)) {
      emitRecord(emit(), level, category, message, attributes, error, bindings);
    }
  }

  const logger: Logger = Object.freeze({
    category,
    enabled(level: Level): boolean {
      return enabled(resolve(category), level);
    },
    with(attributes: AttributesInput | AttributesThunk): Logger {
      let added: Layer;
      if (typeof attributes === "function") {
        added = lazyLayer(attributes);
      } else {
        const normalized = normalizeAttributes(attributes);
        if (Object.keys(normalized).length === 0) {
          return logger;
        }
        added = fixedLayer(freezeDeep(normalized));
      }
      return bindLogger(category, resolve, emit, childBindings(bindings, added));
    },
    trace(message: string, attributes?: AttributesInput | AttributesThunk): void {
      log("trace", message, attributes, undefined);
    },
    debug(message: string, attributes?: AttributesInput | AttributesThunk): void {
      log("debug", message, attributes, undefined);
    },
    info(message: string, attributes?: AttributesInput | AttributesThunk): void {
      log("info", message, attributes, undefined);
    },
    warn(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void {
      log("warn", message, attributes, error);
    },
    error(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void {
      log("error", message, attributes, error);
    },
    fatal(message: string, error?: unknown, attributes?: AttributesInput | AttributesThunk): void {
      log("fatal", message, attributes, error);
    },
  });
  return logger;
}
