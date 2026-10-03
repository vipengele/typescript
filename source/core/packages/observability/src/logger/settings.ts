import type { Threshold } from "@vipengele/ts-core-common";
import { ROOT_CATEGORY, validateCategoryKey } from "./categories";
import { entryFor, type LevelEntry, type LevelTable, validateThreshold } from "./levels";

/**
 * One layer of level configuration: category key (a Category or the root `*`) to its `Threshold`.
 * Every layer this module produces is frozen and prototype-less, so a category named `__proto__`
 * is an ordinary own key.
 */
export type LevelLayer = Readonly<Record<string, Threshold>>;

/**
 * The layers of a {@link LoggingSettings}, lowest precedence first: a later layer's entry for a
 * category replaces an earlier layer's entry for the same category. The environment layer
 * (`VPG_LOG`, ADR-0005) belongs after `overrides`, so it always has the last word.
 */
export const LAYER_ORDER = Object.freeze(["defaults", "builder", "overrides"] as const);

/** The name of one layer in {@link LAYER_ORDER}. */
export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * Every layer of a {@link LoggingSettings}, by name.
 *
 * - `defaults` — `{ "*": "warn" }`, or empty once a builder calls `clearDefaults()`.
 * - `builder` — the builder's sources, flattened in the order they were added.
 * - `overrides` — live overrides set on top of the build.
 */
export type LoggingLayers = Readonly<Record<LayerName, LevelLayer>>;

/**
 * A snapshot of the configuration in force: each layer as it stood, and `levels`, the effective
 * table those layers flatten to. Every part is frozen and none is shared with the state it was
 * taken from, so a snapshot never changes after it is returned.
 *
 * When no layer configures the root `*`, `levels` has no root: `resolveEntry` gives `undefined`
 * for a category no other key governs, and a reader of the shared table falls back to `warn`.
 */
export interface LoggingSettings {
  readonly layers: LoggingLayers;
  readonly levels: LevelTable;
}

/** The defaults layer: every category at `warn` unless something above it says otherwise. */
export const DEFAULT_LEVELS: LevelLayer = freezeLayer({ [ROOT_CATEGORY]: "warn" });

/** An empty layer: the defaults once cleared, or a layer with nothing configured. */
export const EMPTY_LAYER: LevelLayer = freezeLayer({});

/**
 * A frozen, prototype-less copy of `levels`'s own enumerable entries, each category key and
 * threshold validated. Throws a `LoggingConfigError` on the first invalid key or threshold.
 */
export function freezeLayer(levels: Readonly<Record<string, unknown>>): LevelLayer {
  const layer: Record<string, Threshold> = Object.create(null);
  for (const key of Object.keys(levels)) {
    layer[validateCategoryKey(key)] = validateThreshold(levels[key]);
  }
  return Object.freeze(layer);
}

/**
 * Flattens `layers`, lowest precedence first, into one level table: for each category key, the
 * entry of the last layer that sets it. The table and each entry are frozen, and the table is
 * prototype-less. Pure: the layers are only read.
 */
export function flattenLayers(layers: readonly LevelLayer[]): LevelTable {
  const table: Record<string, LevelEntry> = Object.create(null);
  for (const layer of layers) {
    for (const key of Object.keys(layer)) {
      table[key] = Object.freeze(entryFor(layer[key] as Threshold));
    }
  }
  return Object.freeze(table);
}

/**
 * A {@link LoggingSettings} snapshot of `layers`. Each layer is copied through
 * {@link freezeLayer}, so the snapshot is independent of the objects passed in, and a layer that
 * holds an invalid category key or threshold throws a `LoggingConfigError`. `levels` is the
 * layers flattened in {@link LAYER_ORDER}.
 */
export function createSettings(layers: Readonly<Record<LayerName, Readonly<Record<string, unknown>>>>): LoggingSettings {
  const copied = {} as Record<LayerName, LevelLayer>;
  for (const name of LAYER_ORDER) {
    copied[name] = freezeLayer(layers[name]);
  }
  return Object.freeze({
    layers: Object.freeze(copied),
    levels: flattenLayers(LAYER_ORDER.map((name) => copied[name])),
  });
}
