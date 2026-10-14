import type { Threshold } from "@vipengele/ts-core-common";
import { ROOT_CATEGORY } from "./categories";
import { LoggingConfigError } from "./config-error";
import { ENVIRONMENT_VARIABLE } from "./environment-source";
import type { LevelEntry } from "./levels";
import type { LevelLayer, LoggingSettings } from "./settings";
import { parseSpec } from "./spec";

/**
 * What a console handle accepts: a level spec string, a `{ levels }` object mapping category keys
 * to thresholds, `null` to remove every override and the stored spec, or nothing to report the
 * levels in force without changing them.
 */
export type ConsoleHandleInput = string | { readonly levels: Readonly<Record<string, Threshold>> } | null | undefined;

/**
 * The function `installConsole` puts on the global object. Every call confirms itself with one
 * record; an invalid argument throws a `LoggingConfigError` and changes nothing.
 */
export type ConsoleHandle = (input?: ConsoleHandleInput) => void;

/** The Category a console handle's confirmation is written under. */
export const CONSOLE_HANDLE_CATEGORY = "vipengele.logger.console";

/**
 * The key of the tag every console handle carries. `Symbol.for` gives the same symbol in every copy
 * of the package, so a handle another copy installed is recognised as one and may be replaced.
 */
const HANDLE_TAG_KEY = "vipengele.logger.console-handle";

/** What a console handle needs from the provider that installs it. */
export interface ConsoleHandleHost {
  /** The configuration in force, the environment layer read. */
  settings(): LoggingSettings;
  /**
   * Replaces the overrides layer with `overrides` through the provider's live override path,
   * publishing the result, and returns the new configuration.
   */
  setOverrides(overrides: LevelLayer): LoggingSettings;
  /**
   * Writes `message` as a record that no level check suppresses, or, with no sink in force, as one
   * line to the provider's warn target.
   */
  confirm(message: string): void;
}

/** Where a console handle reads and writes the stored spec: `globalThis` unless a test injects another. */
export interface ConsoleStorageHost {
  readonly localStorage?: unknown;
}

/** The parts of `Storage` a console handle uses. */
interface StorageLike {
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function tag(): symbol {
  return Symbol.for(HANDLE_TAG_KEY);
}

/** Whether `value` is a console handle, installed by this copy of the package or another. */
export function isConsoleHandle(value: unknown): boolean {
  return typeof value === "function" && (value as unknown as Record<symbol, unknown>)[tag()] === true;
}

function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `levels` as a level spec, so a `{ levels }` argument is validated exactly as a spec string is. */
function specOfLevels(levels: Readonly<Record<string, unknown>>): string {
  return Object.keys(levels)
    .map((key) => {
      const level = levels[key];
      if (typeof level !== "string") {
        throw new LoggingConfigError(`Invalid logger level of type ${typeName(level)} for category ${JSON.stringify(key)} in { levels }.`);
      }
      return `${key}:${level}`;
    })
    .join(",");
}

/**
 * The levels `input` sets. Throws a `LoggingConfigError` when it is neither a string nor a
 * `{ levels }` object, when any entry of its spec is skipped or repeated, or when it sets no level.
 */
function levelsOf(input: unknown): Readonly<Record<string, Threshold>> {
  let spec: string;
  if (typeof input === "string") {
    spec = input;
  } else if (isRecord(input) && isRecord(input.levels)) {
    spec = specOfLevels(input.levels);
  } else {
    throw new LoggingConfigError(
      `Invalid console handle argument of type ${Array.isArray(input) ? "array" : typeName(input)}: expected a level spec string, { levels }, null or nothing.`,
    );
  }
  const parsed = parseSpec(spec);
  if (parsed.issues.length > 0) {
    throw new LoggingConfigError(`Nothing changed: ${parsed.issues.join(" ")}`);
  }
  if (Object.keys(parsed.levels).length === 0) {
    throw new LoggingConfigError(`Nothing changed: level spec ${JSON.stringify(spec)} sets no level. Pass null to remove every override.`);
  }
  return parsed.levels;
}

/** `levels` as a spec string; every key is a validated category key, so the spec parses back to `levels`. */
function toSpec(levels: Readonly<Record<string, Threshold>>): string {
  return Object.keys(levels)
    .map((key) => `${key}:${levels[key]}`)
    .join(",");
}

/**
 * Merges `levels` into the spec stored under `key` and writes the result back, so a stored spec
 * keeps every category the console set across reloads. An unreadable stored spec contributes its
 * readable entries only. Returns `false` when storage is missing or blocked, writing nothing.
 */
function persist(host: ConsoleStorageHost, key: string, levels: Readonly<Record<string, Threshold>>): boolean {
  try {
    const storage = host.localStorage as StorageLike;
    const stored = storage.getItem(key);
    const merged: Record<string, Threshold> = Object.create(null);
    if (typeof stored === "string") {
      Object.assign(merged, parseSpec(stored).levels);
    }
    Object.assign(merged, levels);
    storage.setItem(key, toSpec(merged));
    return true;
  } catch {
    return false;
  }
}

/** Removes the spec stored under `key`; `false` when storage is missing or blocked. */
function unpersist(host: ConsoleStorageHost, key: string): boolean {
  try {
    (host.localStorage as StorageLike).removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** The effective levels of `settings`, with what a category no key governs falls back to. */
function describeLevels(settings: LoggingSettings): string {
  const { levels } = settings;
  const entries = Object.keys(levels).map((key) => `${key}:${(levels[key] as LevelEntry).level}`);
  if (!Object.hasOwn(levels, ROOT_CATEGORY)) {
    entries.push(entries.length === 0 ? "every category at warn" : "every other category at warn");
  }
  return `${entries.join(", ")}.`;
}

/** The sentence naming every override the environment layer holds a level for, or `undefined` when none. */
function describeShadowed(settings: LoggingSettings): string | undefined {
  const { overrides, environment } = settings.layers;
  const shadowed = Object.keys(overrides).filter((key) => Object.hasOwn(environment, key));
  if (shadowed.length === 0) {
    return undefined;
  }
  const named = shadowed.map((key) => `${key} (${environment[key]}, not ${overrides[key]})`).join(", ");
  return `${ENVIRONMENT_VARIABLE} takes precedence for ${named}.`;
}

/** `sentences` as one line, the ones left `undefined` dropped. */
function line(...sentences: (string | undefined)[]): string {
  return sentences.filter((sentence) => sentence !== undefined).join(" ");
}

/** The handle for `name` on `host`, tagged so any copy of the package recognises it. */
function createHandle(name: string, host: ConsoleHandleHost, storage: ConsoleStorageHost): ConsoleHandle {
  function report(): void {
    const settings = host.settings();
    host.confirm(
      line(
        `Logger levels: ${describeLevels(settings)}`,
        describeShadowed(settings),
        `Call ${name}("category:level"), ${name}({ levels }) or ${name}(null) to change them.`,
      ),
    );
  }

  function clear(): void {
    const settings = host.setOverrides({});
    const key = settings.browserSources?.storageKey;
    let stored: string | undefined;
    if (key !== undefined) {
      stored = unpersist(storage, key)
        ? `Removed the spec stored under localStorage ${JSON.stringify(key)}; levels it set when the page loaded stay in force until the next configure or reload.`
        : `Could not remove the spec stored under localStorage ${JSON.stringify(key)}: storage is blocked.`;
    }
    host.confirm(line(`Logger overrides removed. Levels: ${describeLevels(settings)}`, stored));
  }

  function apply(levels: Readonly<Record<string, Threshold>>): void {
    const overrides: Record<string, Threshold> = Object.create(null);
    Object.assign(overrides, host.settings().layers.overrides, levels);
    const settings = host.setOverrides(overrides);
    const key = settings.browserSources?.storageKey;
    let stored: string;
    if (key === undefined) {
      stored = "Not saved: the configuration in force reads no browser sources, so this applies until the page or process ends.";
    } else if (persist(storage, key, levels)) {
      stored =
        `Saved to localStorage ${JSON.stringify(key)}: after a reload it returns as a builder source, below overrides and below ` +
        "any source added after addBrowserSources, and Logging.reset() does not clear it.";
    } else {
      stored = "Not saved: storage is blocked, so this applies to this page only.";
    }
    host.confirm(line(`Logger levels changed: ${describeLevels(settings)}`, describeShadowed(settings), stored));
  }

  const handle = (input?: ConsoleHandleInput): void => {
    if (input === undefined) {
      report();
    } else if (input === null) {
      clear();
    } else {
      apply(levelsOf(input));
    }
  };
  Object.defineProperty(handle, tag(), { value: true });
  return Object.freeze(handle);
}

/**
 * Installs a console handle for `host` at `globalThis[name]` and returns the function that removes
 * it again. Throws a `LoggingConfigError` when `name` is not a non-empty string, or when
 * `globalThis[name]` holds anything but `undefined` or another console handle — which this one
 * replaces — or cannot be read or written. The returned function removes the handle only while
 * `globalThis[name]` is still this one, so it never removes a handle installed after it.
 */
export function installConsoleHandle(
  name: unknown,
  host: ConsoleHandleHost,
  storage: ConsoleStorageHost = globalThis as ConsoleStorageHost,
): () => void {
  if (typeof name !== "string" || name === "") {
    throw new LoggingConfigError(
      `Invalid console handle name ${typeof name === "string" ? '""' : `of type ${typeName(name)}`}: expected a non-empty string.`,
    );
  }
  const registry = globalThis as unknown as Record<string, unknown>;
  let occupied: boolean;
  try {
    const existing = registry[name];
    occupied = existing !== undefined && !isConsoleHandle(existing);
  } catch {
    occupied = true;
  }
  if (occupied) {
    throw new LoggingConfigError(`Cannot install a console handle at globalThis.${name}: it already holds something else.`);
  }
  const handle = createHandle(name, host, storage);
  try {
    registry[name] = handle;
  } catch {
    throw new LoggingConfigError(`Cannot install a console handle at globalThis.${name}: the property cannot be written.`);
  }
  return () => {
    if (registry[name] === handle && !Reflect.deleteProperty(registry, name)) {
      registry[name] = undefined;
    }
  };
}
