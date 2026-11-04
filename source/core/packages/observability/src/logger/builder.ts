import { type Clock, systemClock, type Threshold } from "@vipengele/ts-core-common";
import { type BrowserSourcesOptions, clearStoredSpec, readBrowserSources } from "./browser-sources";
import { validateCategoryKey } from "./categories";
import { LoggingConfigError } from "./config-error";
import { validateThreshold } from "./levels";
import {
  freezePolicyLayer,
  freezeRateLimitRules,
  freezeSampleRules,
  type PolicyLayer,
  type RateLimitRule,
  type RateLimitSetting,
  type SampleRule,
  type SampleSetting,
} from "./policy";
import type { LogProcessor, RedactionSetting, Sink, SinkRegistration } from "./record";
import {
  type BrowserSourcesSetting,
  DEFAULT_LEVELS,
  defaultRedaction,
  EMPTY_LAYER,
  freezeLayer,
  freezeRegistration,
  type LevelLayer,
} from "./settings";
import { type ParsedSpec, parseSpec } from "./spec";

/**
 * What {@link LoggingBuilder.build} produces: the `defaults` and `builder` layers of a
 * `LoggingSettings`; `policy`, the builder's policy layer; `ignoreEnvironment`, whether the
 * environment layer is left out; `sinks`, `processors`, `clock`, `redaction` and `random`, what its
 * Loggers emit through; `browserSources`, where
 * `addBrowserSources` read; and `issues`, one human-readable string per spec entry an `addSpec` or
 * `addBrowserSources` call skipped or overrode, in the order the specs were added. Issues never
 * fail a build; reporting them is the caller's job.
 */
export interface LoggingBuild {
  readonly defaults: LevelLayer;
  readonly builder: LevelLayer;
  /**
   * The sampling and rate-limit rules passed to `sample` and `rateLimit` and set by the modifiers of
   * `addSpec` and `addBrowserSources` specs, a later rule for a category key replacing an earlier
   * one's; frozen and validated.
   */
  readonly policy: PolicyLayer;
  /** `true` once `ignoreEnvironment` was called: the configuration built leaves `VPG_LOG` out. */
  readonly ignoreEnvironment: boolean;
  /**
   * The sinks passed to `addSink`, in the order they were added, each with the processors passed
   * alongside it; the list, each registration and each processor list are frozen.
   */
  readonly sinks: readonly SinkRegistration[];
  /** The processors passed to `addProcessor`, in the order they were added; frozen. */
  readonly processors: readonly LogProcessor[];
  readonly clock: Clock;
  readonly redaction: RedactionSetting;
  /** The source of the number a sampling rule draws against; `Math.random` unless set. */
  readonly random: () => number;
  /**
   * The storage key of the last `addBrowserSources` call that ran in a browser, frozen; `null` when
   * there was none.
   */
  readonly browserSources: BrowserSourcesSetting | null;
  readonly issues: readonly string[];
}

/** What `addSink` accepts alongside a sink. */
export interface SinkOptions {
  /**
   * The processors that run ahead of this sink alone, in order, after every global processor. A
   * `null` from one drops the record for this sink only.
   */
  readonly processors?: readonly LogProcessor[];
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
   * Leaves the environment layer (`VPG_LOG`) out of the configuration built, for as long as it is
   * in force. It is the only way to remove that layer: `clearDefaults` keeps it, and the next
   * `configure` whose builder does not call this, or a `reset`, brings it back.
   */
  ignoreEnvironment(): LoggingBuilder;

  /**
   * Adds `levels`, category key (a Category or the root `*`) to `Threshold`, as a source. Its own
   * enumerable entries are copied when this is called, so a later change to `levels` has no
   * effect; they are validated by `build`, which throws a `LoggingConfigError` on an invalid key
   * or threshold.
   */
  addLevels(levels: Readonly<Record<string, Threshold>>): LoggingBuilder;

  /**
   * Adds a level spec (`*:warn,react:debug`) as a source, parsed by `parseSpec`. The sampling and
   * rate-limit rules its modifiers set (`db:debug;sample=0.1;limit=20/60`) join the rules of
   * `sample` and `rateLimit` in the order they were added. A bad entry or modifier is skipped,
   * never thrown: it is carried to `build`'s `issues`.
   */
  addSpec(spec: string): LoggingBuilder;

  /**
   * Adds the browser's level specs as sources: the one stored in `localStorage` under
   * `options.storageKey` (`vipengele.log`), then the one in the URL parameter `options.urlParameter`
   * (`log`), so the URL's entry for a category beats the stored one. Both are read when this is
   * called; outside a browser it adds nothing. Every read is guarded: a throw, a missing `location`
   * or blocked storage means no source, and an empty stored string counts as absent. A bad entry is
   * skipped and carried to `build`'s `issues`, naming the URL parameter or the storage key it came
   * from. The rules their modifiers set join the policy layer as an `addSpec` call's do. A
   * non-empty stored spec that holds no level is removed from storage once a provider's
   * configuration built from this builder is in force, never by `build` itself and never because
   * of the URL. Malformed `options` make `build` throw a `LoggingConfigError`.
   */
  addBrowserSources(options?: BrowserSourcesOptions): LoggingBuilder;

  /**
   * Appends `sink` to the sinks every record is written to, in the order they were added, with
   * `options.processors` running ahead of it alone. The sink and its processors are recorded when
   * this is called, the processor list copied, so a later change to it has no effect. They are
   * validated by `build`, which throws a `LoggingConfigError` when `sink` is not an object,
   * `options` is given and is not an object, `options.processors` is given and is not an array,
   * or one of its entries is not a function.
   */
  addSink(sink: Sink, options?: SinkOptions): LoggingBuilder;

  /**
   * Appends `processor` to the processors every record passes through ahead of every sink, in the
   * order they were added; a `null` from one drops the record for every sink. It is recorded when
   * this is called and validated by `build`, which throws a `LoggingConfigError` when it is not a
   * function.
   */
  addProcessor(processor: LogProcessor): LoggingBuilder;

  /**
   * The source of every record's `time`, in epoch ms; `systemClock` unless set. A later call
   * replaces the clock an earlier one set.
   */
  clock(clock: Clock): LoggingBuilder;

  /**
   * The redaction applied to every record: a `RedactionPolicy`, or `null` to disable redaction. The
   * `secretKeys` preset applies unless set. A later call replaces the setting an earlier one made.
   */
  redaction(policy: RedactionSetting): LoggingBuilder;

  /**
   * Adds sampling rules, category key (a Category or the root `*`) to {@link SampleRule}: a category
   * keeps the share of records its governing rule sets, the rule of the longest key that equals it
   * or is a dotted prefix of it. A rule applies to `trace`, `debug` and `info` unless its `upTo`
   * names another highest level; a rate of 1 clears a rule a key would otherwise inherit. A later
   * call's rule for a key replaces an earlier one's. The rules are validated and copied when this is
   * called, which throws a `LoggingConfigError` on an argument that is not an object, or on the first
   * invalid key or rule, leaving the builder unchanged.
   */
  sample(rules: Readonly<Record<string, SampleRule>>): LoggingBuilder;

  /**
   * Adds rate-limit rules, category key to {@link RateLimitRule}: a token bucket of `burst` tokens
   * refilled at `perMinute` a minute, shared by every category the rule governs, by the same
   * longest-prefix rule as `sample`. A rule applies to `trace`, `debug` and `info` unless its `upTo`
   * names another highest level; `false` clears a rule a key would otherwise inherit. A later call's
   * rule for a key replaces an earlier one's. The rules are validated and copied when this is
   * called, which throws a `LoggingConfigError` on an argument that is not an object, or on the first
   * invalid key or rule, leaving the builder unchanged.
   */
  rateLimit(rules: Readonly<Record<string, RateLimitRule>>): LoggingBuilder;

  /**
   * The source of the number a sampling rule draws against, returning a value in `[0, 1)`: a record
   * is kept when it returns less than the rule's rate. `Math.random` unless set. A later call
   * replaces the source an earlier one set.
   */
  random(source: () => number): LoggingBuilder;

  /**
   * Validates every source and sink and returns the resulting build. Throws a `LoggingConfigError`
   * on the first invalid category key or threshold passed to `addLevels`, even one a later source
   * replaces, on an `addLevels` argument that is not an object, or on malformed `addBrowserSources`
   * options, in the order the sources were added; once every source is valid, on the first
   * invalid `addSink` sink, options or per-sink processor, in the order the sinks were added; and
   * once every sink is valid, on the first `addProcessor` argument that is not a function. Reads the builder without changing it, and touches no storage: calling it again
   * gives an equal result.
   */
  build(): LoggingBuild;
}

/** A source as recorded when it is added; validated only by `build`, which throws an `invalid` one's `message`. */
type Source =
  | { readonly kind: "levels"; readonly entries: readonly (readonly [string, unknown])[] }
  | { readonly kind: "invalid"; readonly message: string };

/** A stored spec to remove once a configuration built from it is in force. */
interface StoredSpecClear {
  readonly storageKey: string;
  readonly value: string;
}

/**
 * The stored specs each build found unreadable, keyed by the build. A build carries them here
 * rather than as a field, so `LoggingBuild` stays a plain value and only the provider that commits
 * it acts on them.
 */
const unreadableStoredSpecs = new WeakMap<LoggingBuild, readonly StoredSpecClear[]>();

/**
 * Removes from storage each stored spec `build`'s `addBrowserSources` calls found unreadable, when
 * it is still the value read. The provider calls this once `build`'s configuration is in force;
 * a build no provider commits removes nothing. Never throws.
 */
export function clearUnreadableStoredSpecs(build: LoggingBuild): void {
  for (const clear of unreadableStoredSpecs.get(build) ?? []) {
    clearStoredSpec(clear.storageKey, clear.value);
  }
}

/** A sink as recorded when it is added; validated only by `build`. */
interface RecordedSink {
  readonly sink: unknown;
  readonly options: unknown;
  /** `options.processors` as it stood when the sink was added, an array copied. */
  readonly processors: unknown;
}

function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** `options.processors` as it stands now, an array copied so a later change to it has no effect. */
function recordProcessors(options: unknown): unknown {
  if (!isObject(options)) {
    return undefined;
  }
  const processors = (options as SinkOptions).processors;
  return Array.isArray(processors) ? [...processors] : processors;
}

function validateProcessor(processor: unknown, where: string): LogProcessor {
  if (typeof processor !== "function") {
    throw new LoggingConfigError(`Invalid logger ${where} of type ${typeName(processor)}: expected a function.`);
  }
  return processor as LogProcessor;
}

/** The registration of `recorded`; throws a `LoggingConfigError` on the first invalid part. */
function validateSink(recorded: RecordedSink): SinkRegistration {
  const { sink, options, processors } = recorded;
  if (!isObject(sink)) {
    throw new LoggingConfigError(`Invalid logger sink of type ${typeName(sink)}: expected an object.`);
  }
  if (options !== undefined && !isObject(options)) {
    throw new LoggingConfigError(`Invalid logger sink options of type ${typeName(options)}: expected an object.`);
  }
  if (processors === undefined) {
    return freezeRegistration({ sink: sink as Sink, processors: [] });
  }
  if (!Array.isArray(processors)) {
    throw new LoggingConfigError(`Invalid logger sink processors of type ${typeName(processors)}: expected an array.`);
  }
  return freezeRegistration({
    sink: sink as Sink,
    processors: processors.map((processor: unknown) => validateProcessor(processor, "sink processor")),
  });
}

/** A new {@link LoggingBuilder} holding the defaults, no sources and no sinks. */
export function createLoggingBuilder(): LoggingBuilder {
  let defaults = DEFAULT_LEVELS;
  let ignoreEnvironment = false;
  const sources: Source[] = [];
  const sinks: RecordedSink[] = [];
  const processors: unknown[] = [];
  let clock: Clock = systemClock;
  let redaction: RedactionSetting | undefined;
  const sampleRules: Record<string, SampleSetting> = Object.create(null);
  const rateLimitRules: Record<string, RateLimitSetting | false> = Object.create(null);
  let random: () => number = Math.random;
  const issues: string[] = [];
  let browserSources: BrowserSourcesSetting | null = null;
  const clears: StoredSpecClear[] = [];

  /**
   * Adds a parsed spec's levels as a source and its rules to the policy layer, a rule for a
   * category key replacing the one an earlier spec or `sample`/`rateLimit` call set.
   */
  function addParsed(parsed: ParsedSpec): void {
    sources.push({ kind: "levels", entries: Object.keys(parsed.levels).map((key) => [key, parsed.levels[key]] as const) });
    Object.assign(sampleRules, parsed.policy.sample);
    Object.assign(rateLimitRules, parsed.policy.rateLimit);
    issues.push(...parsed.issues);
  }

  const builder: LoggingBuilder = {
    clearDefaults() {
      defaults = EMPTY_LAYER;
      return builder;
    },
    ignoreEnvironment() {
      ignoreEnvironment = true;
      return builder;
    },
    addLevels(levels) {
      if (typeof levels !== "object" || levels === null) {
        sources.push({ kind: "invalid", message: `Invalid logger levels of type ${typeName(levels)}: expected an object.` });
      } else {
        sources.push({ kind: "levels", entries: Object.keys(levels).map((key) => [key, levels[key]] as const) });
      }
      return builder;
    },
    addSpec(spec) {
      addParsed(parseSpec(spec));
      return builder;
    },
    addBrowserSources(options) {
      const reading = readBrowserSources(options);
      if (reading.kind === "invalid") {
        sources.push({ kind: "invalid", message: reading.message });
      } else if (reading.kind === "read") {
        for (const parsed of reading.specs) {
          addParsed(parsed);
        }
        browserSources = Object.freeze({ storageKey: reading.storageKey });
        if (reading.unreadableStored !== undefined) {
          clears.push({ storageKey: reading.storageKey, value: reading.unreadableStored });
        }
      }
      return builder;
    },
    addSink(sink, options) {
      sinks.push({ sink, options, processors: recordProcessors(options) });
      return builder;
    },
    addProcessor(processor) {
      processors.push(processor);
      return builder;
    },
    clock(next) {
      clock = next;
      return builder;
    },
    redaction(policy) {
      redaction = policy;
      return builder;
    },
    sample(rules) {
      Object.assign(sampleRules, freezeSampleRules(rules));
      return builder;
    },
    rateLimit(rules) {
      Object.assign(rateLimitRules, freezeRateLimitRules(rules));
      return builder;
    },
    random(source) {
      random = source;
      return builder;
    },
    build() {
      const merged: Record<string, Threshold> = Object.create(null);
      for (const source of sources) {
        if (source.kind === "invalid") {
          throw new LoggingConfigError(source.message);
        }
        for (const [key, threshold] of source.entries) {
          merged[validateCategoryKey(key)] = validateThreshold(threshold);
        }
      }
      const registrations = sinks.map(validateSink);
      const global = processors.map((processor) => validateProcessor(processor, "processor"));
      const build: LoggingBuild = Object.freeze({
        defaults,
        builder: freezeLayer(merged),
        policy: freezePolicyLayer({ sample: sampleRules, rateLimit: rateLimitRules }),
        ignoreEnvironment,
        sinks: Object.freeze(registrations),
        processors: Object.freeze(global),
        clock,
        redaction: redaction === undefined ? defaultRedaction() : redaction,
        random,
        browserSources,
        issues: Object.freeze([...issues]),
      });
      if (clears.length > 0) {
        unreadableStoredSpecs.set(build, Object.freeze([...clears]));
      }
      return build;
    },
  };
  return builder;
}
