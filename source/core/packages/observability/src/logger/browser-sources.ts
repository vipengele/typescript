import { detectRuntime, type RuntimeSource } from "@vipengele/ts-core-common/runtime";
import { type ParsedSpec, parseSpec } from "./spec";

/** The URL query parameter `addBrowserSources` reads a level spec from unless told otherwise. */
export const DEFAULT_URL_PARAMETER = "log";

/** The `localStorage` key `addBrowserSources` reads a level spec from unless told otherwise. */
export const DEFAULT_STORAGE_KEY = "vipengele.log";

/** What `addBrowserSources` accepts. */
export interface BrowserSourcesOptions {
  /** The URL query parameter holding a level spec; `log` unless set. A non-empty string. */
  readonly urlParameter?: string;
  /** The `localStorage` key holding a level spec; `vipengele.log` unless set. A non-empty string. */
  readonly storageKey?: string;
}

/**
 * Where the browser sources are read: `globalThis` unless a test injects another. Every member is
 * `unknown` because a page, a sandboxed frame or a fake can put anything there, and reading one
 * can throw (`localStorage` in an opaque-origin frame, or with storage blocked).
 */
export interface BrowserSourcesHost extends RuntimeSource {
  readonly location?: unknown;
  readonly localStorage?: unknown;
}

/** The parts of `Storage` the browser sources use. */
interface StorageLike {
  getItem(key: string): unknown;
  removeItem(key: string): void;
}

/**
 * The outcome of {@link readBrowserSources}:
 *
 * - `invalid` — the options are malformed; `message` says how.
 * - `unavailable` — the host is not a browser, so there is nothing to read.
 * - `read` — `specs` holds the stored spec, then the URL's, each parsed with every issue naming its
 *   source, so the URL wins where both set a category; a source that is absent or unreadable is
 *   left out. `unreadableStored` is the stored value when it is non-empty and holds no level, the
 *   value to remove once a configuration built from this reading is in force.
 */
export type BrowserSourcesReading =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "read";
      readonly storageKey: string;
      readonly specs: readonly ParsedSpec[];
      readonly unreadableStored: string | undefined;
    };

function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/** `value` when it is a non-empty string, `fallback` when it is `undefined`, otherwise a message. */
function optionValue(name: string, value: unknown, fallback: string): { readonly value: string } | { readonly message: string } {
  if (value === undefined) {
    return { value: fallback };
  }
  if (typeof value !== "string" || value === "") {
    return {
      message: `Invalid logger browser sources option ${name} ${typeof value === "string" ? '""' : `of type ${typeName(value)}`}: expected a non-empty string.`,
    };
  }
  return { value };
}

/** The value of `name` in the host's URL query, `undefined` when there is none or reading throws. */
function readUrlParameter(host: BrowserSourcesHost, name: string): string | undefined {
  try {
    const search = (host.location as { readonly search?: unknown } | undefined)?.search;
    if (typeof search !== "string") {
      return undefined;
    }
    return new URLSearchParams(search).get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The value stored under `key`, `undefined` when there is no storage, nothing or an empty string is
 * stored, the value is not a string, or reading throws.
 */
function readStored(host: BrowserSourcesHost, key: string): string | undefined {
  try {
    const value = (host.localStorage as StorageLike).getItem(key);
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** `parseSpec(spec)` with each issue prefixed by `label`, so a warning says where the entry came from. */
function parseLabelled(spec: string, label: string): ParsedSpec {
  const parsed = parseSpec(spec);
  return { levels: parsed.levels, issues: parsed.issues.map((issue) => `${label}: ${issue}`) };
}

/**
 * Reads the level specs of the browser sources: the value stored under `options.storageKey`, then
 * the URL's `options.urlParameter`. A host that is not a browser (`detectRuntime`) reads nothing.
 * Every access is guarded, so a throw, a missing `location` or blocked storage means no source.
 * An empty stored string counts as absent. Reads only, and never throws.
 */
export function readBrowserSources(options: unknown, host: BrowserSourcesHost = globalThis as BrowserSourcesHost): BrowserSourcesReading {
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    return { kind: "invalid", message: `Invalid logger browser sources options of type ${typeName(options)}: expected an object.` };
  }
  const given = (options ?? {}) as BrowserSourcesOptions;
  const urlParameter = optionValue("urlParameter", given.urlParameter, DEFAULT_URL_PARAMETER);
  if ("message" in urlParameter) {
    return { kind: "invalid", message: urlParameter.message };
  }
  const storageKey = optionValue("storageKey", given.storageKey, DEFAULT_STORAGE_KEY);
  if ("message" in storageKey) {
    return { kind: "invalid", message: storageKey.message };
  }
  if (detectRuntime(host) !== "browser") {
    return { kind: "unavailable" };
  }

  const specs: ParsedSpec[] = [];
  let unreadableStored: string | undefined;
  const stored = readStored(host, storageKey.value);
  if (stored !== undefined) {
    const label = `localStorage ${JSON.stringify(storageKey.value)}`;
    const parsed = parseLabelled(stored, label);
    if (Object.keys(parsed.levels).length === 0) {
      unreadableStored = stored;
      specs.push({
        levels: parsed.levels,
        issues: [...parsed.issues, `${label}: the stored spec holds no level and is removed from storage.`],
      });
    } else {
      specs.push(parsed);
    }
  }
  const url = readUrlParameter(host, urlParameter.value);
  if (url !== undefined) {
    specs.push(parseLabelled(url, `URL parameter ${JSON.stringify(urlParameter.value)}`));
  }
  return { kind: "read", storageKey: storageKey.value, specs, unreadableStored };
}

/**
 * Removes the value stored under `key` when it is still `value`, so a spec written since it was
 * read is kept. Guarded like every read: blocked storage, or a throw, removes nothing. Never throws.
 */
export function clearStoredSpec(key: string, value: string, host: BrowserSourcesHost = globalThis as BrowserSourcesHost): void {
  try {
    const storage = host.localStorage as StorageLike;
    if (storage.getItem(key) === value) {
      storage.removeItem(key);
    }
  } catch {
    // Storage that cannot be written leaves the value in place; the next build reports it again.
  }
}
