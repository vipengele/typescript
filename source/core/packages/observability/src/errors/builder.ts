import { type Clock, systemClock } from "@vipengele/ts-core-common";
import type { Integration } from "./integration";
import type { Transport } from "./transport";

/** What a {@link ReporterBuilder} builds: the settings one Reporter holds for its whole life. */
export interface ReporterSettings {
  /** Absent when none was set; every event is then dropped after the pipeline runs. */
  readonly transport?: Transport;
  readonly clock: Clock;
  /** Installed in this order when the Reporter is created, and removed when it is closed. */
  readonly integrations: readonly Integration[];
}

/**
 * Composes a Reporter's settings, starting from the defaults: no transport, the high-resolution
 * epoch clock, and no integrations. Every method returns the builder, so calls chain.
 */
export class ReporterBuilder {
  #transport: Transport | undefined;
  #clock: Clock = systemClock;
  readonly #integrations = new Map<string, Integration>();

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
   * An integration the Reporter installs when it is created. A later call with an integration of
   * the same `name` replaces the earlier one, in the earlier one's place.
   */
  add(integration: Integration): this {
    this.#integrations.set(integration.name, integration);
    return this;
  }

  /** The settings composed so far, as a snapshot a later call on this builder does not change. */
  build(): ReporterSettings {
    return { transport: this.#transport, clock: this.#clock, integrations: [...this.#integrations.values()] };
  }
}
