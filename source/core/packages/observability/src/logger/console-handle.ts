import type { Threshold } from "@vipengele/ts-core-common";
import { ROOT_CATEGORY } from "./categories";
import { LoggingConfigError } from "./config-error";
import { ENVIRONMENT_VARIABLE } from "./environment-source";
import type { LevelEntry } from "./levels";
import { DEFAULT_POLICY_UP_TO, EMPTY_POLICY_LAYER, type PolicyLayer, type RateLimitSetting, type SampleSetting } from "./policy";
import type { LevelLayer, LoggingSettings } from "./settings";
import { type ParsedSpec, parseLevelSpec, parseSpec } from "./spec";

/**
 * What a console handle accepts: a level spec string, its entries optionally carrying sampling and
 * rate-limit modifiers (`db:debug;sample=0.1;limit=20/60`), a `{ levels }` object mapping category
 * keys to thresholds, `null` to remove every override and the stored spec, or nothing to report the
 * levels and rules in force without changing them.
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
   * Replaces the overrides layer with `overrides` and the overrides policy layer with `policy`
   * through the provider's live override path, publishing the result, and returns the new
   * configuration.
   */
  setOverrides(overrides: LevelLayer, policy: PolicyLayer): LoggingSettings;
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

/**
 * `levels` as a level spec, so a `{ levels }` argument is validated as a spec string is, read
 * without modifiers so it sets levels only.
 */
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
 * A change a console handle makes: the levels it sets, and the sampling and rate-limit rules of a
 * spec string, `undefined` for a `{ levels }` object, which leaves every rule as it is.
 */
interface Change {
  readonly levels: Readonly<Record<string, Threshold>>;
  readonly policy: PolicyLayer | undefined;
}

/** Levels together with the rules set for their keys: an overrides layer, or a stored spec. */
interface Entries {
  readonly levels: Readonly<Record<string, Threshold>>;
  readonly policy: PolicyLayer;
}

/**
 * The change `input` makes. Throws a `LoggingConfigError` when it is neither a string nor a
 * `{ levels }` object, when any entry or modifier of its spec is skipped or repeated, or when it
 * sets no level.
 */
function changeOf(input: unknown): Change {
  let parsed: ParsedSpec;
  let spec: string;
  if (typeof input === "string") {
    spec = input;
    parsed = parseSpec(spec);
  } else if (isRecord(input) && isRecord(input.levels)) {
    spec = specOfLevels(input.levels);
    parsed = parseLevelSpec(spec);
  } else {
    throw new LoggingConfigError(
      `Invalid console handle argument of type ${Array.isArray(input) ? "array" : typeName(input)}: expected a level spec string, { levels }, null or nothing.`,
    );
  }
  if (parsed.issues.length > 0) {
    throw new LoggingConfigError(`Nothing changed: ${parsed.issues.join(" ")}`);
  }
  if (Object.keys(parsed.levels).length === 0) {
    throw new LoggingConfigError(`Nothing changed: level spec ${JSON.stringify(spec)} sets no level. Pass null to remove every override.`);
  }
  return { levels: parsed.levels, policy: typeof input === "string" ? parsed.policy : undefined };
}

/**
 * `change` merged into `base`: each level `change` sets replaces `base`'s for its key. With a
 * policy, each key `change` sets a level for also takes its rules from `change`, a rule `base`
 * held for it and `change` does not set removed; without one, `base`'s rules stay as they are.
 */
function merge(base: Entries, change: Change): Entries {
  const levels: Record<string, Threshold> = Object.create(null);
  Object.assign(levels, base.levels, change.levels);
  if (change.policy === undefined) {
    return { levels, policy: base.policy };
  }
  const sample: Record<string, SampleSetting> = Object.create(null);
  const rateLimit: Record<string, RateLimitSetting | false> = Object.create(null);
  Object.assign(sample, base.policy.sample);
  Object.assign(rateLimit, base.policy.rateLimit);
  for (const key of Object.keys(change.levels)) {
    delete sample[key];
    delete rateLimit[key];
  }
  Object.assign(sample, change.policy.sample);
  Object.assign(rateLimit, change.policy.rateLimit);
  return { levels, policy: Object.freeze({ sample: Object.freeze(sample), rateLimit: Object.freeze(rateLimit) }) };
}

/**
 * The modifiers of `key`'s entry in a spec: its sampling rule, its rate limit, then the `upto` they
 * share when it is not the default. The rules of one key always come from one spec entry, so they
 * share one `upTo`.
 */
function modifiersOf(policy: PolicyLayer, key: string): string {
  const sample = policy.sample[key];
  const limit = policy.rateLimit[key];
  let modifiers = "";
  if (sample !== undefined) {
    modifiers += `;sample=${sample.rate}`;
  }
  if (limit !== undefined) {
    modifiers += limit === false ? ";limit=off" : `;limit=${limit.burst}/${limit.perMinute}`;
  }
  const upTo = sample?.upTo ?? (limit || undefined)?.upTo;
  if (upTo !== undefined && upTo !== DEFAULT_POLICY_UP_TO) {
    modifiers += `;upto=${upTo}`;
  }
  return modifiers;
}

/**
 * `entries` as a spec string; every key is a validated category key and every rule a validated
 * rule, so the spec parses back to `entries`.
 */
function toSpec(entries: Entries): string {
  return Object.keys(entries.levels)
    .map((key) => `${key}:${entries.levels[key]}${modifiersOf(entries.policy, key)}`)
    .join(",");
}

/**
 * Merges `change` into the spec stored under `key` and writes the result back, so a stored spec
 * keeps every category the console set, with its modifiers, across reloads. An unreadable stored
 * spec contributes its readable entries only. Returns `false` when storage is missing or blocked,
 * writing nothing.
 */
function persist(host: ConsoleStorageHost, key: string, change: Change): boolean {
  try {
    const storage = host.localStorage as StorageLike;
    const stored = storage.getItem(key);
    const base: Entries = typeof stored === "string" ? parseSpec(stored) : { levels: {}, policy: EMPTY_POLICY_LAYER };
    storage.setItem(key, toSpec(merge(base, change)));
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

/** `rule` as the report names it: its figures, then the highest level it applies to. */
function describeRule(kind: "sample" | "limit", rule: SampleSetting | RateLimitSetting | false | undefined): string | undefined {
  if (rule === undefined) {
    return undefined;
  }
  if (rule === false) {
    return "limit off";
  }
  const figures = "rate" in rule ? `${rule.rate}` : `${rule.burst}/${rule.perMinute}`;
  return `${kind} ${figures} up to ${rule.upTo}`;
}

/**
 * The sentence naming the sampling and rate-limit rule each key holds in `settings`' flattened
 * policy, or `undefined` when it holds none, so a configuration without rules reports its levels
 * alone.
 */
function describePolicy(settings: LoggingSettings): string | undefined {
  const { sample, rateLimit } = settings.policy;
  const keys = [...new Set([...Object.keys(sample), ...Object.keys(rateLimit)])];
  if (keys.length === 0) {
    return undefined;
  }
  const entries = keys.map((key) => {
    const rules = [describeRule("sample", sample[key]), describeRule("limit", rateLimit[key])];
    return `${key} (${rules.filter((rule) => rule !== undefined).join(", ")})`;
  });
  return `Sampling and rate limits: ${entries.join(", ")}.`;
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
        describePolicy(settings),
        describeShadowed(settings),
        `Call ${name}("category:level"), ${name}({ levels }) or ${name}(null) to change them.`,
      ),
    );
  }

  function clear(): void {
    const settings = host.setOverrides({}, EMPTY_POLICY_LAYER);
    const key = settings.browserSources?.storageKey;
    let stored: string | undefined;
    if (key !== undefined) {
      stored = unpersist(storage, key)
        ? `Removed the spec stored under localStorage ${JSON.stringify(key)}; levels it set when the page loaded stay in force until the next configure or reload.`
        : `Could not remove the spec stored under localStorage ${JSON.stringify(key)}: storage is blocked.`;
    }
    host.confirm(line(`Logger overrides removed. Levels: ${describeLevels(settings)}`, describePolicy(settings), stored));
  }

  function apply(change: Change): void {
    const current = host.settings();
    const overrides = merge({ levels: current.layers.overrides, policy: current.policyLayers.overrides }, change);
    const settings = host.setOverrides(overrides.levels, overrides.policy);
    const key = settings.browserSources?.storageKey;
    let stored: string;
    if (key === undefined) {
      stored = "Not saved: the configuration in force reads no browser sources, so this applies until the page or process ends.";
    } else if (persist(storage, key, change)) {
      stored =
        `Saved to localStorage ${JSON.stringify(key)}: after a reload it returns as a builder source, below overrides and below ` +
        "any source added after addBrowserSources, and Logging.reset() does not clear it.";
    } else {
      stored = "Not saved: storage is blocked, so this applies to this page only.";
    }
    host.confirm(line(`Logger levels changed: ${describeLevels(settings)}`, describePolicy(settings), describeShadowed(settings), stored));
  }

  const handle = (input?: ConsoleHandleInput): void => {
    if (input === undefined) {
      report();
    } else if (input === null) {
      clear();
    } else {
      apply(changeOf(input));
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
