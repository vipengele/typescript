import type { Threshold } from "@vipengele/ts-core-common";
import { validateCategoryKey } from "./categories";
import { LoggingConfigError } from "./config-error";
import { validateThreshold } from "./levels";
import { DEFAULT_LEVELS, EMPTY_LAYER, freezeLayer, type LevelLayer } from "./settings";
import { parseSpec } from "./spec";

/**
 * What {@link LoggingBuilder.build} produces: the `defaults` and `builder` layers of a
 * `LoggingSettings`, and `issues`, one human-readable string per spec entry an `addSpec` call
 * skipped or overrode, in the order the specs were added. Issues never fail a build; reporting
 * them is the caller's job.
 */
export interface LoggingBuild {
  readonly defaults: LevelLayer;
  readonly builder: LevelLayer;
  readonly issues: readonly string[];
}

/**
 * Composes level configuration from the defaults. Every method but `build` returns the builder
 * itself, so calls chain. Sources are applied in the order they were added, a later source's
 * entry for a category replacing an earlier one's.
 */
export interface LoggingBuilder {
  /**
   * Drops the defaults layer (`{ "*": "warn" }`). With no source configuring `*` either, the
   * effective table has no root; see `LoggingSettings`.
   */
  clearDefaults(): LoggingBuilder;

  /**
   * Adds `levels`, category key (a Category or the root `*`) to `Threshold`, as a source. Its own
   * enumerable entries are copied when this is called, so a later change to `levels` has no
   * effect; they are validated by `build`, which throws a `LoggingConfigError` on an invalid key
   * or threshold.
   */
  addLevels(levels: Readonly<Record<string, Threshold>>): LoggingBuilder;

  /**
   * Adds a level spec (`*:warn,react:debug`) as a source, parsed by `parseSpec`. A bad entry is
   * skipped, never thrown: it is carried to `build`'s `issues`.
   */
  addSpec(spec: string): LoggingBuilder;

  /**
   * Validates every source and returns the resulting layers. Throws a `LoggingConfigError` on the
   * first invalid category key or threshold passed to `addLevels`, even one a later source
   * replaces, or on an `addLevels` argument that is not an object. Reads the builder without
   * changing it: calling it again gives an equal result.
   */
  build(): LoggingBuild;
}

/** A source as recorded when it is added; validated only by `build`. */
type Source =
  | { readonly kind: "levels"; readonly entries: readonly (readonly [string, unknown])[] }
  | { readonly kind: "invalid"; readonly value: unknown };

/** A new {@link LoggingBuilder} holding the defaults and no sources. */
export function createLoggingBuilder(): LoggingBuilder {
  let defaults = DEFAULT_LEVELS;
  const sources: Source[] = [];
  const issues: string[] = [];

  const builder: LoggingBuilder = {
    clearDefaults() {
      defaults = EMPTY_LAYER;
      return builder;
    },
    addLevels(levels) {
      if (typeof levels !== "object" || levels === null) {
        sources.push({ kind: "invalid", value: levels });
      } else {
        sources.push({ kind: "levels", entries: Object.keys(levels).map((key) => [key, levels[key]] as const) });
      }
      return builder;
    },
    addSpec(spec) {
      const parsed = parseSpec(spec);
      sources.push({ kind: "levels", entries: Object.keys(parsed.levels).map((key) => [key, parsed.levels[key]] as const) });
      issues.push(...parsed.issues);
      return builder;
    },
    build() {
      const merged: Record<string, Threshold> = Object.create(null);
      for (const source of sources) {
        if (source.kind === "invalid") {
          const value = source.value;
          throw new LoggingConfigError(`Invalid logger levels of type ${value === null ? "null" : typeof value}: expected an object.`);
        }
        for (const [key, threshold] of source.entries) {
          merged[validateCategoryKey(key)] = validateThreshold(threshold);
        }
      }
      return Object.freeze({ defaults, builder: freezeLayer(merged), issues: Object.freeze([...issues]) });
    },
  };
  return builder;
}
