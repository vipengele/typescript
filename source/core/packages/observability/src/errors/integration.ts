import type { AttributesInput, Level } from "@vipengele/ts-core-common";
import type { Mechanism } from "./event";

/** What {@link IntegrationHost.capture} accepts beside the error itself. */
export interface IntegrationCaptureContext {
  /** How the error reached the reporter; copied onto the event, so each event holds its own. */
  readonly mechanism: Mechanism;
  /** Defaults to `"error"`; a value that is not a level becomes `"error"` too. */
  readonly level?: Level;
  /** Normalized once, at capture, into the event's `attributes`. */
  readonly attributes?: AttributesInput;
}

/** The part of a Reporter an {@link Integration} reaches: its capture pipeline and its transport's `flush`. */
export interface IntegrationHost {
  /** Runs `error` through the reporter's pipeline under the integration's own mechanism. Never throws; returns the event's id. */
  capture(error: unknown, context: IntegrationCaptureContext): string;
  /** Delegates to the reporter's `flush`. */
  flush(timeoutMs?: number): Promise<boolean>;
}

/**
 * A piece a Reporter installs when it is created and removes when it is closed — a listener on
 * global state, for instance. Its `name` identifies it within one builder: adding a second
 * integration of the same name replaces the first.
 */
export interface Integration {
  readonly name: string;
  /** Installs the integration; the function it returns, if any, removes it again. */
  // biome-ignore lint/suspicious/noConfusingVoidType: a setup with nothing to tear down returns nothing at all.
  setup(host: IntegrationHost): (() => void) | void;
}

/**
 * Runs every integration's `setup` against `host`, in order, and returns the function that removes
 * them all again, last installed first. A `setup` or a teardown that throws is contained: that
 * integration is skipped, and every other one still installs or tears down. The returned function
 * tears down only once; a later call does nothing.
 */
export function setupIntegrations(integrations: readonly Integration[], host: IntegrationHost): () => void {
  const teardowns: (() => void)[] = [];
  for (const integration of integrations) {
    try {
      const teardown = integration.setup(host);
      if (typeof teardown === "function") {
        teardowns.push(teardown);
      }
    } catch {
      // The integration is skipped; creating a reporter never throws because of one.
    }
  }

  return () => {
    for (const teardown of teardowns.splice(0).reverse()) {
      try {
        teardown();
      } catch {
        // The integration stays installed; closing a reporter never throws because of one.
      }
    }
  };
}
