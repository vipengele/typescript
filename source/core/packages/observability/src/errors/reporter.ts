import type { AttributesInput, Level } from "@vipengele/ts-core-common";
import { ReporterBuilder } from "./builder";
import type { Mechanism } from "./event";
import { createCapture } from "./pipeline";

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
  /** Delegates to the transport's `close`; resolves `true` when there is no transport. */
  close(timeoutMs?: number): Promise<boolean>;
}

/** An error the application caught and handed over itself. */
const CAPTURED: Mechanism = { handled: true, source: "capture" };

/**
 * Creates a {@link Reporter} from a builder that starts from the defaults — no transport, the
 * high-resolution epoch clock — and that `configure` adds to. Creating one installs nothing: every
 * piece of state lives in the returned object.
 */
export function createReporter(configure?: (builder: ReporterBuilder) => ReporterBuilder): Reporter {
  const initial = new ReporterBuilder();
  const { transport, clock } = (configure === undefined ? initial : configure(initial)).build();
  const capture = createCapture({ clock, transport, processors: [], filters: [] });

  return {
    captureException(error, context) {
      return capture({ kind: "exception", error, level: context?.level, attributes: context?.attributes }, { ...CAPTURED });
    },
    captureMessage(message, level) {
      return capture({ kind: "message", message, level }, { ...CAPTURED });
    },
    async flush(timeoutMs) {
      return transport === undefined ? true : transport.flush(timeoutMs);
    },
    async close(timeoutMs) {
      return transport === undefined ? true : transport.close(timeoutMs);
    },
  };
}
