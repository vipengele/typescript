import type { AttributesInput, Level } from "@vipengele/ts-core-common";
import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { ReporterBuilder } from "./builder";
import type { Mechanism } from "./event";
import { setupIntegrations } from "./integration";
import { createCapture } from "./pipeline";
import { detectRuntimeContext } from "./runtime-context";

/** What {@link Reporter.captureException} accepts beside the error itself. */
export interface CaptureContext {
  /** Normalized once, at capture, into the event's `attributes`. */
  readonly attributes?: AttributesInput;
  /** Defaults to `"error"`; a value that is not a level becomes `"error"` too. */
  readonly level?: Level;
}

/**
 * Turns captured errors and messages into Error Events and hands them to its transport. No capture
 * method throws, and each returns the event's id whether or not the event was delivered.
 */
export interface Reporter {
  /** Captures `error` — an `Error` with its whole `cause`/`errors` chain, or any other thrown value. */
  captureException(error: unknown, context?: CaptureContext): string;
  /** Captures `message` at `level`, `"error"` by default. */
  captureMessage(message: string, level?: Level): string;
  /** Delegates to the transport's `flush`; resolves `true` when there is no transport. */
  flush(timeoutMs?: number): Promise<boolean>;
  /**
   * Removes every integration, once, then delegates to the transport's `close`; resolves `true`
   * when there is no transport.
   */
  close(timeoutMs?: number): Promise<boolean>;
}

/** An error the application caught and handed over itself. */
const CAPTURED: Mechanism = { handled: true, source: "capture" };

/**
 * Writes each detected runtime-context key the Resource holds no value for, leaving every key that
 * already has one as it is. A throw anywhere — detecting, reading or writing the Resource — leaves
 * the Resource with whatever it holds and never reaches the caller.
 */
function fillRuntimeContext(): void {
  try {
    const current = Scope.resource();
    const unset: Partial<Record<keyof Resource, string>> = {};
    for (const [key, value] of Object.entries(detectRuntimeContext()) as [keyof Resource, string][]) {
      if (current[key] === undefined) {
        unset[key] = value;
      }
    }
    Scope.setResource(unset);
  } catch {
    // The Resource keeps what it holds; a reporter is worth more than its detected runtime context.
  }
}

/**
 * Creates a {@link Reporter} from a builder that starts from the defaults — no transport, the
 * high-resolution epoch clock, no integrations, the `secretKeys` redaction preset, no processors
 * and no `beforeSend` — and that `configure` adds to. Without integrations, creating one installs
 * nothing beyond the runtime context it fills into the Resource: every other piece of state lives
 * in the returned object. Each integration is set up here, and whatever global state it installs
 * belongs to the reporter until `close()` removes it.
 *
 * Creating one detects the runtime, operating system, browser and device once and writes each
 * detected key to the Resource only when the Resource holds no value for it, so a value an
 * application sets through `Scope.setResource` — before or after — always wins, and a second
 * reporter fills only the keys still unset when it is created. Detection that fails leaves the
 * Resource as it is and the reporter working.
 */
export function createReporter(configure?: (builder: ReporterBuilder) => ReporterBuilder): Reporter {
  const initial = new ReporterBuilder();
  const {
    transport,
    clock,
    projectRoot,
    integrations,
    redaction,
    limits,
    enabledEnvironments,
    processors,
    beforeSend,
    sampleRate,
    random,
    ignoreErrors,
  } = (configure === undefined ? initial : configure(initial)).build();
  fillRuntimeContext();
  const capture = createCapture({
    clock,
    transport,
    projectRoot,
    redaction,
    limits,
    enabledEnvironments,
    processors,
    beforeSend,
    sampleRate,
    random,
    ignoreErrors,
  });
  const flush = async (timeoutMs?: number): Promise<boolean> => (transport === undefined ? true : transport.flush(timeoutMs));
  const teardown = setupIntegrations(integrations, {
    capture(error, { mechanism, level, attributes }) {
      return capture({ kind: "exception", error, level, attributes }, { ...mechanism });
    },
    flush,
  });

  return {
    captureException(error, context) {
      return capture({ kind: "exception", error, level: context?.level, attributes: context?.attributes }, { ...CAPTURED });
    },
    captureMessage(message, level) {
      return capture({ kind: "message", message, level }, { ...CAPTURED });
    },
    flush,
    async close(timeoutMs) {
      teardown();
      return transport === undefined ? true : transport.close(timeoutMs);
    },
  };
}
