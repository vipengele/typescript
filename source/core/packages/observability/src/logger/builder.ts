import { type Clock, systemClock, type Threshold } from "@vipengele/ts-core-common";
import { validateCategoryKey } from "./categories";
import { LoggingConfigError } from "./config-error";
import { validateThreshold } from "./levels";
import type { LogProcessor, RedactionSetting, Sink, SinkRegistration } from "./record";
import { DEFAULT_LEVELS, defaultRedaction, EMPTY_LAYER, freezeLayer, freezeRegistration, type LevelLayer } from "./settings";
import { parseSpec } from "./spec";

/**
 * What {@link LoggingBuilder.build} produces: the `defaults` and `builder` layers of a
 * `LoggingSettings`; `ignoreEnvironment`, whether the environment layer is left out; `sinks`,
 * `processors`, `clock` and `redaction`, what its Loggers emit through; and `issues`, one
 * human-readable string per spec entry an `addSpec` call skipped or overrode, in the order the
 * specs were added. Issues never fail a build; reporting them is the caller's job.
 */
export interface LoggingBuild {
  readonly defaults: LevelLayer;
  readonly builder: LevelLayer;
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
   * Adds a level spec (`*:warn,react:debug`) as a source, parsed by `parseSpec`. A bad entry is
   * skipped, never thrown: it is carried to `build`'s `issues`.
   */
  addSpec(spec: string): LoggingBuilder;

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
   * Validates every source and sink and returns the resulting build. Throws a `LoggingConfigError`
   * on the first invalid category key or threshold passed to `addLevels`, even one a later source
   * replaces, or on an `addLevels` argument that is not an object; once every source is valid, on
   * the first invalid `addSink` sink, options or per-sink processor, in the order the sinks were
   * added; and once every sink is valid, on the first `addProcessor` argument that is not a
   * function. Reads the builder without changing it: calling it again gives an equal result.
   */
  build(): LoggingBuild;
}

/** A source as recorded when it is added; validated only by `build`. */
type Source =
  | { readonly kind: "levels"; readonly entries: readonly (readonly [string, unknown])[] }
  | { readonly kind: "invalid"; readonly value: unknown };

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
  const issues: string[] = [];

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
    build() {
      const merged: Record<string, Threshold> = Object.create(null);
      for (const source of sources) {
        if (source.kind === "invalid") {
          const value = source.value;
          throw new LoggingConfigError(`Invalid logger levels of type ${typeName(value)}: expected an object.`);
        }
        for (const [key, threshold] of source.entries) {
          merged[validateCategoryKey(key)] = validateThreshold(threshold);
        }
      }
      const registrations = sinks.map(validateSink);
      const global = processors.map((processor) => validateProcessor(processor, "processor"));
      return Object.freeze({
        defaults,
        builder: freezeLayer(merged),
        ignoreEnvironment,
        sinks: Object.freeze(registrations),
        processors: Object.freeze(global),
        clock,
        redaction: redaction === undefined ? defaultRedaction() : redaction,
        issues: Object.freeze([...issues]),
      });
    },
  };
  return builder;
}
