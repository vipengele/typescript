import { type Clock, isLevel, type Level, SEVERITY_NUMBERS } from "@vipengele/ts-core-common";
import { createTokenBucket, type TokenBucket } from "../token-bucket";
import { governingKeys, validateCategoryKey } from "./categories";
import { LoggingConfigError } from "./config-error";

/**
 * A sampling rule for a category key: the share of records kept, from 0 to 1, or that share with
 * the highest level it applies to. A record is kept when `random()` returns less than `rate`. A
 * rate of 1 keeps every record, so it clears a rule the key would otherwise inherit.
 */
export type SampleRule = number | { readonly rate: number; readonly upTo?: Level };

/**
 * A rate-limit rule for a category key: a token bucket holding at most `burst` tokens and gaining
 * `perMinute` a minute, with the highest level it applies to, or `false`, which clears a rule the
 * key would otherwise inherit.
 */
export type RateLimitRule = false | { readonly burst: number; readonly perMinute: number; readonly upTo?: Level };

/** The highest level a rule applies to unless it sets `upTo`: `warn` and above always pass. */
export const DEFAULT_POLICY_UP_TO: Level = "info";

/** A validated, frozen sampling rule. */
export interface SampleSetting {
  readonly rate: number;
  readonly upTo: Level;
}

/** A validated, frozen rate-limit rule. */
export interface RateLimitSetting {
  readonly burst: number;
  readonly perMinute: number;
  readonly upTo: Level;
}

/** Category key to the sampling rule set for it. Frozen and prototype-less. */
export type SampleRules = Readonly<Record<string, SampleSetting>>;

/** Category key to the rate-limit rule set for it, `false` clearing an inherited one. Frozen and prototype-less. */
export type RateLimitRules = Readonly<Record<string, RateLimitSetting | false>>;

/**
 * One layer of policy configuration. The two kinds of rule are independent: a key that sets only a
 * rate limit leaves the sampling rule it inherits in place, and a key that sets only a level sets
 * no policy at all.
 */
export interface PolicyLayer {
  readonly sample: SampleRules;
  readonly rateLimit: RateLimitRules;
}

/** What {@link freezePolicyLayer} accepts: either kind of rule may be omitted. */
export interface PolicyLayerInput {
  readonly sample?: Readonly<Record<string, unknown>>;
  readonly rateLimit?: Readonly<Record<string, unknown>>;
}

/** A sampling rule in a flattened {@link PolicyTable}. */
export type SampleEntry = SampleSetting;

/**
 * A rate-limit rule in a flattened {@link PolicyTable}. `id` names the rule by its category key and
 * its value, so two tables holding the same rule under the same key give it the same `id`.
 */
export interface RateLimitEntry extends RateLimitSetting {
  readonly key: string;
  readonly id: string;
}

/** Category key to the sampling rule that wins for it. Frozen and prototype-less; replaced, never mutated. */
export type SampleTable = Readonly<Record<string, SampleEntry>>;

/** Category key to the rate-limit rule that wins for it. Frozen and prototype-less; replaced, never mutated. */
export type RateLimitTable = Readonly<Record<string, RateLimitEntry | false>>;

/** The policy layers flattened, each kind of rule in its own table. */
export interface PolicyTable {
  readonly sample: SampleTable;
  readonly rateLimit: RateLimitTable;
}

function emptyRules<T>(): Readonly<Record<string, T>> {
  return Object.freeze(Object.create(null) as Record<string, T>);
}

/** A layer with no rules. */
export const EMPTY_POLICY_LAYER: PolicyLayer = Object.freeze({
  sample: emptyRules<SampleSetting>(),
  rateLimit: emptyRules<RateLimitSetting | false>(),
});

function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return typeof value === "number" ? String(value) : `of type ${value === null ? "null" : typeof value}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function validateUpTo(value: unknown, what: string): Level {
  if (value === undefined) {
    return DEFAULT_POLICY_UP_TO;
  }
  if (!isLevel(value)) {
    throw new LoggingConfigError(`Invalid ${what} upTo ${describe(value)}: expected one of trace, debug, info, warn, error or fatal.`);
  }
  return value;
}

/**
 * The frozen {@link SampleSetting} `rule` sets for `key`, its `upTo` defaulting to
 * {@link DEFAULT_POLICY_UP_TO}.
 *
 * @throws {LoggingConfigError} When `rule` is neither a number nor an object, its rate is not a
 * number from 0 to 1, or its `upTo` is not a level.
 */
export function validateSampleRule(rule: unknown, key: string): SampleSetting {
  const what = `logger sample rule for ${JSON.stringify(key)}`;
  const rate = isRecord(rule) ? rule.rate : rule;
  if (typeof rate !== "number" || !(rate >= 0 && rate <= 1)) {
    throw new LoggingConfigError(`Invalid ${what}: rate ${describe(rate)} is not a number from 0 to 1.`);
  }
  const upTo = validateUpTo(isRecord(rule) ? rule.upTo : undefined, what);
  return Object.freeze({ rate, upTo });
}

/**
 * The frozen {@link RateLimitSetting} `rule` sets for `key`, or `false`, its `upTo` defaulting to
 * {@link DEFAULT_POLICY_UP_TO}.
 *
 * @throws {LoggingConfigError} When `rule` is neither `false` nor an object, its `burst` is not a
 * finite number of at least 1, its `perMinute` is not a positive finite number, or its `upTo` is
 * not a level.
 */
export function validateRateLimitRule(rule: unknown, key: string): RateLimitSetting | false {
  const what = `logger rate limit for ${JSON.stringify(key)}`;
  if (rule === false) {
    return false;
  }
  if (!isRecord(rule)) {
    throw new LoggingConfigError(`Invalid ${what} ${describe(rule)}: expected false or an object.`);
  }
  const { burst, perMinute } = rule;
  if (typeof burst !== "number" || !Number.isFinite(burst) || burst < 1) {
    throw new LoggingConfigError(`Invalid ${what}: burst ${describe(burst)} is not a finite number of at least 1.`);
  }
  if (typeof perMinute !== "number" || !Number.isFinite(perMinute) || perMinute <= 0) {
    throw new LoggingConfigError(`Invalid ${what}: perMinute ${describe(perMinute)} is not a positive finite number.`);
  }
  return Object.freeze({ burst, perMinute, upTo: validateUpTo(rule.upTo, what) });
}

function freezeRules<T>(rules: unknown, kind: string, validate: (rule: unknown, key: string) => T): Readonly<Record<string, T>> {
  if (!isRecord(rules)) {
    throw new LoggingConfigError(`Invalid logger ${kind} rules ${describe(rules)}: expected an object keyed by category.`);
  }
  const frozen: Record<string, T> = Object.create(null);
  for (const key of Object.keys(rules)) {
    frozen[validateCategoryKey(key)] = validate(rules[key], key);
  }
  return Object.freeze(frozen);
}

/**
 * A frozen, prototype-less copy of `rules`'s own enumerable entries, each category key and
 * sampling rule validated.
 *
 * @throws {LoggingConfigError} When `rules` is not an object, or on the first invalid key or rule.
 */
export function freezeSampleRules(rules: unknown): SampleRules {
  return freezeRules(rules, "sample", validateSampleRule);
}

/**
 * A frozen, prototype-less copy of `rules`'s own enumerable entries, each category key and
 * rate-limit rule validated.
 *
 * @throws {LoggingConfigError} When `rules` is not an object, or on the first invalid key or rule.
 */
export function freezeRateLimitRules(rules: unknown): RateLimitRules {
  return freezeRules(rules, "rate limit", validateRateLimitRule);
}

/**
 * A frozen {@link PolicyLayer} copied from `input`, every key and rule validated; an omitted kind
 * is empty. A layer this module produced passes through unchanged in content.
 *
 * @throws {LoggingConfigError} On the first invalid key or rule.
 */
export function freezePolicyLayer(input: PolicyLayerInput): PolicyLayer {
  return Object.freeze({
    sample: input.sample === undefined ? EMPTY_POLICY_LAYER.sample : freezeSampleRules(input.sample),
    rateLimit: input.rateLimit === undefined ? EMPTY_POLICY_LAYER.rateLimit : freezeRateLimitRules(input.rateLimit),
  });
}

/** The `id` of the rate-limit rule `setting` under `key`. */
function ruleId(key: string, setting: RateLimitSetting): string {
  return JSON.stringify([key, setting.burst, setting.perMinute, setting.upTo]);
}

/**
 * Flattens `layers`, lowest precedence first, into one {@link PolicyTable}: for each category key
 * and each kind of rule, the rule of the last layer that sets it. A clearing rule (rate 1, or
 * `false`) is kept, so it still shadows the rule of a shorter key. Every table and entry is frozen
 * and every table prototype-less. Pure: the layers are only read.
 */
export function flattenPolicyLayers(layers: readonly PolicyLayer[]): PolicyTable {
  const sample: Record<string, SampleEntry> = Object.create(null);
  const rateLimit: Record<string, RateLimitEntry | false> = Object.create(null);
  for (const layer of layers) {
    for (const key of Object.keys(layer.sample)) {
      sample[key] = layer.sample[key] as SampleSetting;
    }
    for (const key of Object.keys(layer.rateLimit)) {
      const setting = layer.rateLimit[key] as RateLimitSetting | false;
      rateLimit[key] = setting === false ? false : Object.freeze({ ...setting, key, id: ruleId(key, setting) });
    }
  }
  return Object.freeze({ sample: Object.freeze(sample), rateLimit: Object.freeze(rateLimit) });
}

/**
 * Memoized resolutions per table, keyed by table identity, which is sound only because a table is
 * replaced rather than mutated. Each copy of this package keeps its own: it holds nothing another
 * copy needs to agree on.
 */
const sampleResolutions = new WeakMap<SampleTable, Map<string, SampleEntry | undefined>>();
const rateLimitResolutions = new WeakMap<RateLimitTable, Map<string, RateLimitEntry | undefined>>();

function resolveGoverning<E, R extends E>(
  memos: WeakMap<Readonly<Record<string, E>>, Map<string, R | undefined>>,
  table: Readonly<Record<string, E>>,
  category: string,
  active: (entry: E) => entry is R,
): R | undefined {
  let memo = memos.get(table);
  if (memo === undefined) {
    memo = new Map();
    memos.set(table, memo);
  } else if (memo.has(category)) {
    return memo.get(category);
  }
  let resolved: R | undefined;
  for (const key of governingKeys(category)) {
    if (Object.hasOwn(table, key)) {
      const entry = table[key] as E;
      resolved = active(entry) ? entry : undefined;
      break;
    }
  }
  memo.set(category, resolved);
  return resolved;
}

function isActiveSample(entry: SampleEntry): entry is SampleEntry {
  return entry.rate < 1;
}

function isActiveRateLimit(entry: RateLimitEntry | false): entry is RateLimitEntry {
  return entry !== false;
}

/**
 * The sampling rule that governs `category` in `table`: the rule of the longest key that equals
 * `category` or is a prefix of it ending at a `.` boundary, else the root `*`'s. `undefined` when
 * no key governs it or the governing rule has a rate of 1. Only own properties count.
 */
export function resolveSampling(table: SampleTable, category: string): SampleEntry | undefined {
  return resolveGoverning(sampleResolutions, table, category, isActiveSample);
}

/**
 * The rate-limit rule that governs `category` in `table`, by the same longest-prefix rule as
 * {@link resolveSampling}. `undefined` when no key governs it or the governing rule is `false`.
 */
export function resolveRateLimit(table: RateLimitTable, category: string): RateLimitEntry | undefined {
  return resolveGoverning(rateLimitResolutions, table, category, isActiveRateLimit);
}

/** The state one rate-limit rule keeps: its bucket, and the records it dropped not yet reported. */
export interface RuleState {
  readonly bucket: TokenBucket;
  dropped: number;
}

/**
 * The outcome of an admitted call. `time` is the clock reading the rate limit took, which becomes
 * the record's time, or `undefined` when no rate limit applied and the clock was not read.
 * `dropped` is the count of records the admitting rule dropped since it last reported one, `0`
 * when there are none or no rate limit applied.
 */
export interface Admission {
  readonly time: number | undefined;
  readonly dropped: number;
  /**
   * Marks `dropped` as reported. Called once the record carrying it is built; a record whose build
   * fails is never settled, so its count rides the next admitted record. A second call does nothing.
   */
  settle(): void;
}

/** The admission of a call no rate limit applied to. */
const UNLIMITED: Admission = Object.freeze({ time: undefined, dropped: 0, settle() {} });

class LimitedAdmission implements Admission {
  readonly time: number;
  readonly dropped: number;
  #state: RuleState | undefined;

  constructor(time: number, state: RuleState) {
    this.time = time;
    this.dropped = state.dropped;
    this.#state = state;
  }

  settle(): void {
    if (this.#state !== undefined) {
      // A drop counted between admission and settlement stays pending.
      this.#state.dropped -= this.dropped;
      this.#state = undefined;
    }
  }
}

/** Whether `rule` covers a record at `level`: its severity is at most that of the rule's `upTo`. */
function covers(rule: { readonly upTo: Level }, level: Level): boolean {
  return SEVERITY_NUMBERS[level] <= SEVERITY_NUMBERS[rule.upTo];
}

/** Whether a record is kept at `rate`. A throwing `random` drops it. */
function isSampled(random: () => number, rate: number): boolean {
  try {
    return random() < rate;
  } catch {
    return false;
  }
}

/** A clock reading, or `undefined` when the clock throws. */
function readClock(clock: Clock): number | undefined {
  try {
    return clock();
  } catch {
    return undefined;
  }
}

/**
 * The flattened policy in force together with the state of its rate-limit rules: one token bucket
 * and one dropped counter per rule, shared by every category the rule governs. State is local to
 * the provider that holds the policy.
 */
export class LogPolicy {
  readonly table: PolicyTable;
  /** Each active rate-limit rule's state, by the rule's `id`. */
  readonly states: ReadonlyMap<string, RuleState>;

  /**
   * A policy over `table`. A rule whose `id` (key and value) `previous` also holds keeps
   * `previous`'s bucket and dropped counter; any other rule starts with a full bucket and no drops.
   */
  constructor(table: PolicyTable, previous?: LogPolicy) {
    const states = new Map<string, RuleState>();
    for (const key of Object.keys(table.rateLimit)) {
      const entry = table.rateLimit[key] as RateLimitEntry | false;
      if (entry !== false) {
        states.set(entry.id, previous?.states.get(entry.id) ?? { bucket: createTokenBucket(entry), dropped: 0 });
      }
    }
    this.table = table;
    this.states = states;
  }

  /**
   * Whether a call at `level` in `category` goes on to build a record. Sampling runs first: a
   * record its governing rule covers is kept when `random()` returns less than the rate, and a
   * sampled-out record is dropped uncounted and takes no token. The rate limit runs next: when its
   * governing rule covers the record, `clock` is read once and the rule's bucket takes a token at
   * that time; a record that finds no whole token is dropped and counted against the rule. A
   * throwing `random` or `clock` drops the record silently, takes no token and is not counted.
   *
   * Returns the {@link Admission} of an admitted call, or `undefined` for a dropped one. Never throws.
   */
  admit(category: string, level: Level, random: () => number, clock: Clock): Admission | undefined {
    const sample = resolveSampling(this.table.sample, category);
    if (sample !== undefined && covers(sample, level) && !isSampled(random, sample.rate)) {
      return undefined;
    }
    const limit = resolveRateLimit(this.table.rateLimit, category);
    if (limit === undefined || !covers(limit, level)) {
      return UNLIMITED;
    }
    const time = readClock(clock);
    if (time === undefined) {
      return undefined;
    }
    const state = this.states.get(limit.id) as RuleState;
    if (!state.bucket.take(time)) {
      state.dropped += 1;
      return undefined;
    }
    return new LimitedAdmission(time, state);
  }
}
