import { type Clock, type SerializeErrorOptions, systemClock } from "@vipengele/ts-core-common";
import { secretKeys } from "@vipengele/ts-core-redaction";
import type { RedactionSetting } from "../redaction";
import type { Integration } from "./integration";
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
   * The bounds applied when an event's exception chain is serialized. Only the options a
   * `limits` call set are present; an absent one takes `serializeError`'s default.
   */
  readonly limits: Readonly<SerializeErrorOptions>;
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

/**
 * Composes a Reporter's settings, starting from the defaults: no transport, the high-resolution
 * epoch clock, no integrations, and the `secretKeys` redaction preset. Every method returns the
 * builder, so calls chain.
 */
export class ReporterBuilder {
  #transport: Transport | undefined;
  #clock: Clock = systemClock;
  #projectRoot: string | undefined;
  #redaction: RedactionSetting | undefined;
  readonly #integrations = new Map<string, Integration>();
  #limits: Readonly<SerializeErrorOptions> = Object.freeze({});

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
    };
  }
}
