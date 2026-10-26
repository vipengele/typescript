import { type Clock, type SerializeErrorOptions, systemClock } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import type { RedactionSetting } from "../redaction";
import type { Integration } from "./integration";
import type { ErrorEventProcessor } from "./pipeline";
import { ReporterConfigError } from "./reporter-config-error";
import type { Transport } from "./transport";

/** What a {@link ReporterBuilder} builds: the settings one Reporter holds for its whole life. */
export interface ReporterSettings {
  /** Absent when none was set; every event is then dropped after the pipeline runs. */
  readonly transport?: Transport;
  readonly clock: Clock;
  /** Absent when none was set; every frame outside `node_modules` is then in-app. */
  readonly projectRoot?: string;
  /** Installed in this order when the Reporter is created, and removed when it is closed. */
  readonly integrations: readonly Integration[];
  /**
   * Applied to every event after enrichment and before any processor: to its `attributes`, to
   * `mechanism.data`, and to every link of its exception chain as the logger applies it to a
   * record's error. `null` disables it.
   */
  readonly redaction: RedactionSetting;
  /**
   * The bounds every event is cut to: its attributes, `message`, exception chain and each link's
   * `frames`. Only the options a `limits` call set are present; an absent one takes
   * `serializeError`'s default.
   */
  readonly limits: Readonly<SerializeErrorOptions>;
  /**
   * The `deployment.environment.name` values events are sent for, checked before anything else on
   * every capture. Absent when none was set; every environment is then enabled.
   */
  readonly enabledEnvironments?: readonly string[];
  /** Run on every event after redaction, in the order they were added; frozen. */
  readonly processors: readonly ErrorEventProcessor[];
  /** Run on every event after every processor. Absent when none was set. */
  readonly beforeSend?: ErrorEventProcessor;
  /** The share of events kept, from 0 to 1: an event is kept when `random()` returns less than it. */
  readonly sampleRate: number;
  /** The source of the number every event is sampled with, in `[0, 1)`. */
  readonly random: () => number;
  /**
   * Matched against every event after normalization; a match drops it. A string matches as a
   * substring, a RegExp as it is tested; frozen.
   */
  readonly ignoreErrors: readonly (string | RegExp)[];
}

/** The options {@link ReporterBuilder.limits} accepts, in the order they are validated. */
const LIMIT_KEYS = ["maxDepth", "maxBreadth", "maxStringLength", "maxLinks", "maxErrors"] as const;

/** A limit is a positive integer, or `Infinity` for no bound. */
function isLimit(value: unknown): value is number {
  return value === Number.POSITIVE_INFINITY || (Number.isInteger(value) && (value as number) > 0);
}

function describe(value: unknown): string {
  return typeof value === "number" ? String(value) : `of type ${value === null ? "null" : typeof value}`;
}

/** A sample rate is a number from 0 to 1, both included. */
function isSampleRate(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function validateProcessor(processor: unknown, what: string): ErrorEventProcessor {
  if (typeof processor !== "function") {
    throw new ReporterConfigError(`Invalid reporter ${what} ${describe(processor)}: expected a function.`);
  }
  return processor as ErrorEventProcessor;
}

/**
 * Composes a Reporter's settings, starting from the defaults: no transport, the high-resolution
 * epoch clock, no integrations, the `secretKeys` redaction preset, no processors, no
 * `beforeSend`, a sample rate of 1 drawn with `Math.random`, and no ignored errors. Every method
 * returns the builder, so calls chain.
 */
export class ReporterBuilder {
  #transport: Transport | undefined;
  #clock: Clock = systemClock;
  #projectRoot: string | undefined;
  #redaction: RedactionSetting | undefined;
  readonly #integrations = new Map<string, Integration>();
  #limits: Readonly<SerializeErrorOptions> = Object.freeze({});
  #enabledEnvironments: readonly string[] | undefined;
  #processors: readonly ErrorEventProcessor[] = Object.freeze([]);
  #beforeSend: ErrorEventProcessor | undefined;
  #sampleRate = 1;
  #random: () => number = Math.random;
  #ignoreErrors: readonly (string | RegExp)[] = Object.freeze([]);

  /** Where captured events go. A later call replaces the transport an earlier one set. */
  transport(transport: Transport): this {
    this.#transport = transport;
    return this;
  }

  /** The source of every event's `time`, in epoch ms. A later call replaces the clock an earlier one set. */
  clock(clock: Clock): this {
    this.#clock = clock;
    return this;
  }

  /**
   * The source of the number every event is sampled with, returning a value in `[0, 1)`. A later
   * call replaces the source an earlier one set.
   */
  random(source: () => number): this {
    this.#random = source;
    return this;
  }

  /**
   * Where the application's own code lives, as a filesystem path or a URL prefix such as
   * `https://app.example.com/`. Only frames whose file sits under it are in-app. An empty or
   * whitespace-only path counts as unset. A later call replaces the path an earlier one set.
   */
  projectRoot(path: string): this {
    this.#projectRoot = path;
    return this;
  }

  /**
   * The redaction applied to every event: a `RedactionPolicy`, or `null` to disable redaction. The
   * `secretKeys` preset applies unless set. A later call replaces the setting an earlier one made.
   */
  redaction(policy: RedactionSetting): this {
    this.#redaction = policy;
    return this;
  }

  /**
   * An integration the Reporter installs when it is created. A later call with an integration of
   * the same `name` replaces the earlier one, in the earlier one's place.
   */
  add(integration: Integration): this {
    this.#integrations.set(integration.name, integration);
    return this;
  }

  /**
   * The bounds on an event's serialized exception chain: any of `maxDepth`, `maxBreadth`,
   * `maxStringLength`, `maxLinks` and `maxErrors`, each a positive integer or `Infinity`. An option
   * left `undefined` keeps the value an earlier call set, or `serializeError`'s default. A later
   * call replaces only the options it sets.
   *
   * @throws {ReporterConfigError} When `limits` is not an object, or any option set is not a positive integer or `Infinity`;
   * the builder is then left as it was.
   */
  limits(limits: SerializeErrorOptions): this {
    if (typeof limits !== "object" || limits === null) {
      throw new ReporterConfigError(`Invalid reporter limits ${describe(limits)}: expected an object.`);
    }
    const merged: Record<string, number> = { ...this.#limits };
    for (const key of LIMIT_KEYS) {
      const value: unknown = limits[key];
      if (value === undefined) {
        continue;
      }
      if (!isLimit(value)) {
        throw new ReporterConfigError(`Invalid reporter limit ${key} ${describe(value)}: expected a positive integer or Infinity.`);
      }
      merged[key] = value;
    }
    this.#limits = Object.freeze(merged);
    return this;
  }

  /**
   * The allow-list of `deployment.environment.name` values the Reporter sends events for. A capture
   * whose Resource names an environment the list does not hold — the empty string included — is
   * dropped before it is normalized, and still returns its id. A Resource with no environment is
   * always enabled. The list is copied, so a later change to `environments` does not change it. A
   * later call replaces the list an earlier one set.
   *
   * @throws {ReporterConfigError} When `environments` is not an array, is empty, or holds an entry
   * that is not a string; the builder is then left as it was.
   */
  enabledEnvironments(environments: readonly string[]): this {
    if (!Array.isArray(environments)) {
      throw new ReporterConfigError(`Invalid reporter enabled environments ${describe(environments)}: expected an array of strings.`);
    }
    const copy: unknown[] = [...environments];
    if (copy.length === 0) {
      throw new ReporterConfigError("Invalid reporter enabled environments: expected at least one environment.");
    }
    for (const [index, environment] of copy.entries()) {
      if (typeof environment !== "string") {
        throw new ReporterConfigError(
          `Invalid reporter enabled environment at index ${index} ${describe(environment)}: expected a string.`,
        );
      }
    }
    this.#enabledEnvironments = Object.freeze(copy as string[]);
    return this;
  }

  /**
   * A processor run on every event after redaction, after every processor added before it, and
   * before `beforeSend`. It returns the event to pass on, or `null` to drop it; a throw drops the
   * event too. Every call adds one more processor.
   *
   * @throws {ReporterConfigError} When `processor` is not a function; the builder is then left as it was.
   */
  addProcessor(processor: ErrorEventProcessor): this {
    this.#processors = Object.freeze([...this.#processors, validateProcessor(processor, "processor")]);
    return this;
  }

  /**
   * The hook run on every event after every processor, last before the transport. It returns the
   * event to send, or `null` to drop it; a throw drops the event too. A later call replaces the hook
   * an earlier one set.
   *
   * @throws {ReporterConfigError} When `hook` is not a function; the builder is then left as it was.
   */
  beforeSend(hook: ErrorEventProcessor): this {
    this.#beforeSend = validateProcessor(hook, "beforeSend hook");
    return this;
  }

  /**
   * The share of events the Reporter keeps, from 0 to 1. Each event is kept when `random()` returns
   * less than `rate`, so 1 keeps every event and 0 drops every one. An event outside the sample is
   * dropped right after the environment gate, before it is normalized, and still returns its id. A
   * later call replaces the rate an earlier one set.
   *
   * @throws {ReporterConfigError} When `rate` is not a number from 0 to 1; the builder is then left as it was.
   */
  sampleRate(rate: number): this {
    if (!isSampleRate(rate)) {
      throw new ReporterConfigError(`Invalid reporter sample rate ${describe(rate)}: expected a number from 0 to 1.`);
    }
    this.#sampleRate = rate;
    return this;
  }

  /**
   * The errors the Reporter drops. Each pattern is tried against the top exception's
   * `"<type>: <message>"` and against its message alone, or against a captured message's text: a
   * string matches as a substring, a RegExp when its `test` passes with `lastIndex` set to 0. A
   * matching event is dropped after normalization, before enrichment, and still returns its id. The
   * list is copied, so a later change to `patterns` does not change it; `[]` drops nothing. A later
   * call replaces the list an earlier one set.
   *
   * @throws {ReporterConfigError} When `patterns` is not an array, or holds an entry that is neither
   * a string nor a RegExp; the builder is then left as it was.
   */
  ignoreErrors(patterns: readonly (string | RegExp)[]): this {
    if (!Array.isArray(patterns)) {
      throw new ReporterConfigError(`Invalid reporter ignoreErrors ${describe(patterns)}: expected an array of strings and RegExps.`);
    }
    const copy: unknown[] = [...patterns];
    for (const [index, pattern] of copy.entries()) {
      if (typeof pattern !== "string" && !(pattern instanceof RegExp)) {
        throw new ReporterConfigError(
          `Invalid reporter ignoreErrors pattern at index ${index} ${describe(pattern)}: expected a string or a RegExp.`,
        );
      }
    }
    this.#ignoreErrors = Object.freeze(copy as (string | RegExp)[]);
    return this;
  }

  /** The settings composed so far, as a snapshot a later call on this builder does not change. */
  build(): ReporterSettings {
    return {
      transport: this.#transport,
      clock: this.#clock,
      projectRoot: this.#projectRoot,
      integrations: [...this.#integrations.values()],
      // The preset is read when a build is made, never at module scope (ADR-0011).
      redaction: this.#redaction === undefined ? secretKeys : this.#redaction,
      limits: this.#limits,
      enabledEnvironments: this.#enabledEnvironments,
      processors: this.#processors,
      beforeSend: this.#beforeSend,
      sampleRate: this.#sampleRate,
      random: this.#random,
      ignoreErrors: this.#ignoreErrors,
    };
  }
}
