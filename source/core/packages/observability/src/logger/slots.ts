import { type Level, SEVERITY_NUMBERS } from "@vipengele/ts-core-common";
import { entryFor, isThreshold, type LevelEntry, type LevelTable, resolveEntry, severityOf } from "./levels";

// Dotted rather than colon-style: the key is a cross-version protocol fixed by ADR-0005.
const LEVELS_SLOT_KEY = "vipengele.logger.levels";

// Versioned by record protocol, not package version, per ADR-0005.
const PROVIDER_SLOT_KEY = "vipengele.logger.provider.v1";

type Registry = Record<symbol, unknown>;

/**
 * The entry a malformed slot entry, or a table with no root, resolves to: the package's default
 * `warn`. `off` would be stricter, but it silences `error` and `fatal` records from a category
 * because some writer stored garbage; `warn` is what the category gets when nothing is configured,
 * so a malformed entry never enables more than the quiet default and never hides an error.
 */
const FALLBACK_LEVEL = "warn";

/** Every level, least severe first, for placing a foreign severity against the levels this copy knows. */
const LEVELS_BY_SEVERITY = (Object.keys(SEVERITY_NUMBERS) as Level[]).sort((a, b) => SEVERITY_NUMBERS[a] - SEVERITY_NUMBERS[b]);

/**
 * Resolved tables, keyed by the published table's identity (a canonical table maps to itself), so
 * repeated reads of one published table skip the scan and `resolveEntry`'s identity-keyed memo stays warm. Each
 * copy keeps its own: a view is derived from the slot, never shared through it.
 */
const views = new WeakMap<object, LevelTable>();

/** The table a slot holding a non-object reads as; created on first need, then reused for stable identity. */
let fallbackTable: LevelTable | undefined;

function registry(): Registry {
  return globalThis as unknown as Registry;
}

/**
 * The slot symbols, resolved on first use so importing this module touches no registry. `Symbol.for`
 * returns the same symbol for a key in every copy, so holding it here shares nothing extra and
 * spares each `Logger.enabled()` a global symbol-registry lookup.
 */
let levelsSymbol: symbol | undefined;
let providerSymbol: symbol | undefined;

function levelsSlot(): symbol {
  levelsSymbol ??= Symbol.for(LEVELS_SLOT_KEY);
  return levelsSymbol;
}

/** The default level table, `{ "*": "warn" }`, as a fresh frozen, prototype-less object. */
function defaultTable(): LevelTable {
  return freezeTable({ "*": entryFor(FALLBACK_LEVEL) });
}

function freezeTable(entries: Readonly<Record<string, LevelEntry>>): LevelTable {
  const table: Record<string, LevelEntry> = Object.create(null);
  for (const key of Object.keys(entries)) {
    const entry = entries[key] as LevelEntry;
    table[key] = Object.freeze({ level: entry.level, severity: entry.severity });
  }
  return Object.freeze(table);
}

/** Whether `value` is an entry this copy understands as-is: a known threshold carrying its own severity. */
function isCanonicalEntry(value: unknown): value is LevelEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { level, severity } = value as Partial<Record<keyof LevelEntry, unknown>>;
  return isThreshold(level) && severity === severityOf(level);
}

/**
 * Maps a level-table entry, possibly written by another version of this package, to one this copy
 * understands.
 *
 * - A known level name is authoritative: the entry is that threshold, whatever severity it carries.
 * - An unknown name is placed by its carried `severity` at the nearest known level at or above
 *   it, so this copy never enables a record the foreign entry excludes; a severity above `fatal`
 *   resolves to `off`, and one below `trace` to `trace`.
 * - A malformed entry — not an object, or an unknown name without a finite `severity` — resolves
 *   to the default `warn`, never to everything on.
 */
export function normalizeEntry(value: unknown): LevelEntry {
  if (typeof value !== "object" || value === null) {
    return entryFor(FALLBACK_LEVEL);
  }
  const { level, severity } = value as Partial<Record<keyof LevelEntry, unknown>>;
  if (isThreshold(level)) {
    return entryFor(level);
  }
  if (typeof severity !== "number" || !Number.isFinite(severity)) {
    return entryFor(FALLBACK_LEVEL);
  }
  const nearest = LEVELS_BY_SEVERITY.find((known) => SEVERITY_NUMBERS[known] >= severity);
  return entryFor(nearest ?? "off");
}

/**
 * The table this copy resolves against for `published`, a value read from the levels slot. A table
 * whose every entry is already understood is returned as-is; otherwise a normalised view is built.
 * Either outcome is cached by the published table's identity, so a repeat read neither rescans the
 * table nor changes the view's identity. This relies on a published table being replaced, never
 * mutated, the same contract as `resolveEntry`'s memo. `published` itself is never written to. A
 * non-object reads as the default table.
 */
export function normalizeTable(published: unknown): LevelTable {
  if (typeof published !== "object" || published === null) {
    fallbackTable ??= defaultTable();
    return fallbackTable;
  }
  const cached = views.get(published);
  if (cached !== undefined) {
    return cached;
  }
  const source = published as Readonly<Record<string, unknown>>;
  const keys = Object.keys(source);
  let view: LevelTable;
  if (keys.every((key) => isCanonicalEntry(source[key]))) {
    view = source as LevelTable;
  } else {
    const entries: Record<string, LevelEntry> = Object.create(null);
    for (const key of keys) {
      entries[key] = normalizeEntry(source[key]);
    }
    view = freezeTable(entries);
  }
  views.set(published, view);
  return view;
}

/**
 * The level table every copy of this package in the realm shares, normalised for this copy (see
 * {@link normalizeTable}). When the slot is empty, the default `{ "*": "warn" }` is published
 * first; a slot another copy already filled is read, never overwritten or mutated.
 */
export function readLevelTable(): LevelTable {
  const slot = levelsSlot();
  if (registry()[slot] === undefined) {
    registry()[slot] = defaultTable();
  }
  return normalizeTable(registry()[slot]);
}

/**
 * Publishes `table` to the shared levels slot by replacing the slot's table with a frozen,
 * prototype-less copy of it, and returns that copy. The table it replaces is left untouched, so a
 * reader holding it, or a memo keyed by it, never sees it change.
 */
export function publishLevelTable(table: LevelTable): LevelTable {
  const published = freezeTable(table);
  registry()[levelsSlot()] = published;
  return published;
}

/**
 * The entry that governs `category` in the shared level table, resolved through `resolveEntry`
 * so the memo is keyed by the table's identity. A table with no entry for `category` or the root
 * resolves to the default `warn`.
 */
export function resolveSharedEntry(category: string): LevelEntry {
  return resolveEntry(readLevelTable(), category) ?? entryFor(FALLBACK_LEVEL);
}

/**
 * The realm's default logger provider. When the provider slot is empty, `create()` is called and
 * its result stored; otherwise the stored value is returned and `create` is never called, so the
 * first copy of this package to ask wins. The value is opaque here: every copy sharing the slot's
 * record-protocol version agrees on its shape.
 */
export function getOrCreateDefaultProvider<T>(create: () => T): T {
  providerSymbol ??= Symbol.for(PROVIDER_SLOT_KEY);
  const slot = providerSymbol;
  if (registry()[slot] === undefined) {
    registry()[slot] = create();
  }
  return registry()[slot] as T;
}
