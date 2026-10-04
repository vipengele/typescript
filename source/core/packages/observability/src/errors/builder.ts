import { type Clock, systemClock } from "@vipengele/ts-core-common";
import type { Integration } from "./integration";
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
}

/**
 * Composes a Reporter's settings, starting from the defaults: no transport, the high-resolution
 * epoch clock, and no integrations. Every method returns the builder, so calls chain.
 */
export class ReporterBuilder {
  #transport: Transport | undefined;
  #clock: Clock = systemClock;
  #projectRoot: string | undefined;
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
   * Where the application's own code lives, as a filesystem path or a URL prefix such as
   * `https://app.example.com/`. Only frames whose file sits under it are in-app. An empty or
   * whitespace-only path counts as unset. A later call replaces the path an earlier one set.
   */
  projectRoot(path: string): this {
    this.#projectRoot = path;
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
    return {
      transport: this.#transport,
      clock: this.#clock,
      projectRoot: this.#projectRoot,
      integrations: [...this.#integrations.values()],
    };
  }
}
