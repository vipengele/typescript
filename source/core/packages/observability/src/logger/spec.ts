import { isLevel, type Level, type Threshold } from "@vipengele/ts-core-common";
import { isCategoryKey } from "./categories";
import { isThreshold } from "./levels";
import {
  EMPTY_POLICY_LAYER,
  type PolicyLayer,
  type RateLimitSetting,
  type SampleSetting,
  validateRateLimitRule,
  validateSampleRule,
} from "./policy";

/**
 * The outcome of {@link parseSpec}. `levels` is a prototype-less object mapping each category key
 * (a Category or the root `*`) to its `Threshold`, so a category named `__proto__` is an ordinary
 * own key and plain assignment cannot reach `Object.prototype`. `policy` holds the sampling and
 * rate-limit rules the entries' modifiers set, frozen and prototype-less, each under a key that
 * also has a level in `levels`. `issues` holds one human-readable string per skipped or overridden
 * entry or modifier, each quoting the entry it describes; it is empty when the spec was clean.
 */
export interface ParsedSpec {
  readonly levels: Readonly<Record<string, Threshold>>;
  readonly policy: PolicyLayer;
  readonly issues: readonly string[];
}

/**
 * A rate, a burst or a per-minute figure in a modifier: digits with an optional fraction and
 * exponent, as `String` writes a non-negative number. A sign, `0x`, `Infinity` or an empty value is
 * not one.
 */
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const LEVEL_NAMES = "trace, debug, info, warn, error or fatal";

/** What one entry's modifiers set. */
interface EntryModifiers {
  sample?: number;
  limit?: { readonly burst: number; readonly perMinute: number } | false;
  upTo?: Level;
  /** The `upto` modifier as written, kept so an `upto` that applies to nothing can be reported. */
  upToModifier?: string;
}

/** `text` as a finite non-negative number, or `undefined` when it is not one. */
function parseNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** The rate-limit rule a `limit` value sets, or `undefined` when it is neither `off` nor `<burst>/<perMinute>`. */
function parseLimit(value: string): EntryModifiers["limit"] {
  if (value === "off") {
    return false;
  }
  const parts = value.split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  const burst = parseNumber((parts[0] as string).trim());
  const perMinute = parseNumber((parts[1] as string).trim());
  if (burst === undefined || burst < 1 || perMinute === undefined || perMinute <= 0) {
    return undefined;
  }
  return { burst, perMinute };
}

/**
 * Reads `modifier` (`name=value`) into `modifiers`, returning why it is skipped, or `undefined`
 * when it is read.
 */
function readModifier(modifier: string, modifiers: EntryModifiers): string | undefined {
  const parts = modifier.split("=");
  if (parts.length !== 2) {
    return 'expected "name=value" with exactly one "="';
  }
  const name = (parts[0] as string).trim();
  const value = (parts[1] as string).trim();
  if (name === "sample") {
    const rate = parseNumber(value);
    if (rate === undefined || rate > 1) {
      return `sample ${JSON.stringify(value)} is not a rate from 0 to 1`;
    }
    modifiers.sample = rate;
  } else if (name === "limit") {
    const limit = parseLimit(value);
    if (limit === undefined) {
      return `limit ${JSON.stringify(value)} is not "off" or "<burst>/<perMinute>" with a burst of at least 1 and a positive perMinute`;
    }
    modifiers.limit = limit;
  } else if (name === "upto") {
    if (!isLevel(value)) {
      return `upto ${JSON.stringify(value)} is not one of ${LEVEL_NAMES}`;
    }
    modifiers.upTo = value;
    modifiers.upToModifier = modifier;
  } else {
    return `unknown modifier ${JSON.stringify(name)}: expected sample, limit or upto`;
  }
  return undefined;
}

/**
 * Reads the modifiers of `entry`, each trimmed, an empty one ignored. A modifier that cannot be
 * read is skipped and described in `issues`; a name given twice keeps the last value and is
 * reported. An `upto` is reported when the entry sets neither a `sample` nor a `limit`.
 */
function readModifiers(entry: string, raw: readonly string[], issues: string[]): EntryModifiers {
  const modifiers: EntryModifiers = {};
  const seen = new Set<string>();
  const prefix = `Level spec entry ${JSON.stringify(entry)}`;
  for (const text of raw) {
    const modifier = text.trim();
    if (modifier === "") {
      continue;
    }
    const reason = readModifier(modifier, modifiers);
    if (reason !== undefined) {
      issues.push(`${prefix} keeps its level but skips modifier ${JSON.stringify(modifier)}: ${reason}.`);
      continue;
    }
    const name = (modifier.split("=")[0] as string).trim();
    if (seen.has(name)) {
      issues.push(`${prefix} repeats modifier ${JSON.stringify(name)}: the last one wins.`);
    }
    seen.add(name);
  }
  if (modifiers.upToModifier !== undefined && modifiers.sample === undefined && modifiers.limit === undefined) {
    issues.push(
      `${prefix} keeps its level but skips modifier ${JSON.stringify(modifiers.upToModifier)}: the entry sets no sample or limit.`,
    );
  }
  return modifiers;
}

/** The text of one entry split into its category, its level and its modifiers. */
interface EntryParts {
  readonly category: string;
  readonly level: string;
  readonly modifiers: readonly string[];
}

/** The parts of `entry`, or why it is skipped. With `withModifiers` unset, everything after the `:` is the level. */
function splitEntry(entry: string, withModifiers: boolean): EntryParts | string {
  const parts = entry.split(":");
  if (parts.length !== 2) {
    return 'expected "category:level" with exactly one ":"';
  }
  const category = (parts[0] as string).trim();
  const rest = withModifiers ? (parts[1] as string).split(";") : [parts[1] as string];
  const level = (rest[0] as string).trim();
  if (!isCategoryKey(category)) {
    return `invalid category ${JSON.stringify(category)}`;
  }
  if (!isThreshold(level)) {
    return `invalid level ${JSON.stringify(level)}`;
  }
  return { category, level, modifiers: rest.slice(1) };
}

function parse(spec: string, withModifiers: boolean): ParsedSpec {
  const levels: Record<string, Threshold> = Object.create(null);
  const sample: Record<string, SampleSetting> = Object.create(null);
  const rateLimit: Record<string, RateLimitSetting | false> = Object.create(null);
  const issues: string[] = [];
  if (typeof spec !== "string") {
    issues.push(`Level spec must be a string, received ${spec === null ? "null" : typeof spec}.`);
    return { levels, policy: EMPTY_POLICY_LAYER, issues };
  }
  for (const raw of spec.split(",")) {
    const entry = raw.trim();
    if (entry === "") {
      continue;
    }
    const parts = splitEntry(entry, withModifiers);
    if (typeof parts === "string") {
      issues.push(`Level spec entry ${JSON.stringify(entry)} is skipped: ${parts}.`);
      continue;
    }
    const { category } = parts;
    if (Object.hasOwn(levels, category)) {
      issues.push(`Level spec entry ${JSON.stringify(entry)} repeats category ${JSON.stringify(category)}: the last entry wins.`);
      delete sample[category];
      delete rateLimit[category];
    }
    levels[category] = parts.level as Threshold;
    const modifiers = readModifiers(entry, parts.modifiers, issues);
    if (modifiers.sample !== undefined) {
      sample[category] = validateSampleRule({ rate: modifiers.sample, upTo: modifiers.upTo }, category);
    }
    if (modifiers.limit !== undefined) {
      rateLimit[category] = validateRateLimitRule(modifiers.limit && { ...modifiers.limit, upTo: modifiers.upTo }, category);
    }
  }
  return { levels, policy: Object.freeze({ sample: Object.freeze(sample), rateLimit: Object.freeze(rateLimit) }), issues };
}

/**
 * Parses a level spec of the form `category:level,category:level`, where a category is a Category
 * or the root `*` and a level is a `Threshold` (`*:warn,react:debug`). Whitespace around entries
 * and around either side of the `:` is ignored, and an empty entry (an empty spec, a trailing
 * comma) is ignored without an issue.
 *
 * A level may be followed by `;`-separated modifiers setting the category's sampling and rate-limit
 * rules (`db:debug;sample=0.1;limit=20/60;upto=info`): `sample=<rate>` keeps that share of records,
 * from 0 to 1; `limit=<burst>/<perMinute>` sets a token bucket, and `limit=off` clears an inherited
 * one, as `sample=1` clears an inherited sampling rule; `upto=<level>` names the highest level
 * whichever of the two the entry sets applies to, `info` unless given. A modifier that cannot be
 * read is skipped and described in `issues`, and the entry's level still applies.
 *
 * An entry with no `:`, more than one `:`, an invalid category or an invalid level is skipped and
 * described in `issues`. A category that appears more than once keeps the last entry, its level and
 * its modifiers, and every earlier occurrence is reported as an issue. Never throws: a non-string
 * `spec` yields no levels and one issue.
 */
export function parseSpec(spec: string): ParsedSpec {
  return parse(spec, true);
}

/**
 * Parses `spec` as {@link parseSpec} does with modifiers left unread: everything after an entry's
 * `:` is its level, so an entry carrying a modifier is skipped for an invalid level, and `policy`
 * is always empty.
 */
export function parseLevelSpec(spec: string): ParsedSpec {
  return parse(spec, false);
}
