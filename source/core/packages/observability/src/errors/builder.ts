import { type Clock, systemClock } from "@vipengele/ts-core-common";
import type { Transport } from "./transport";

/** What a {@link ReporterBuilder} builds: the settings one Reporter holds for its whole life. */
export interface ReporterSettings {
  /** Absent when none was set; every event is then dropped after the pipeline runs. */
  readonly transport?: Transport;
  readonly clock: Clock;
}

/**
 * Composes a Reporter's settings, starting from the defaults: no transport, and the
 * high-resolution epoch clock. Every method returns the builder, so calls chain.
 */
export class ReporterBuilder {
  #transport: Transport | undefined;
  #clock: Clock = systemClock;

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

  /** The settings composed so far, as a snapshot a later call on this builder does not change. */
  build(): ReporterSettings {
    return { transport: this.#transport, clock: this.#clock };
  }
}
