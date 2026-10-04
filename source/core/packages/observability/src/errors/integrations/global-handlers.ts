import { detectCapability } from "@vipengele/ts-core-common/runtime";
import type { Level } from "@vipengele/ts-core-common";
import type { Mechanism } from "../event";
import type { Integration, IntegrationHost } from "../integration";

/** What the process does after a global handler captures an error: exit with code 1 once the transport flushes, or keep running. */
export type ExitPolicy = "exit" | "continue";

/**
 * The `error` event a {@link GlobalEventTarget} dispatches, typed structurally so it never
 * depends on the DOM's `ErrorEvent` — a name this entry point gives to its own event type.
 */
export interface GlobalErrorEventLike {
  /** The thrown value; `null` or absent for a cross-origin `"Script error."`. */
  readonly error?: unknown;
  readonly message?: string;
}

/** The `unhandledrejection` event a {@link GlobalEventTarget} dispatches. */
export interface GlobalRejectionEventLike {
  /** The rejection reason, whatever was passed to `reject` — not necessarily an `Error`. */
  readonly reason?: unknown;
}

/** The subset of the browser's `globalThis` a {@link globalHandlers} integration listens on. */
export interface GlobalEventTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (event: never) => void): void;
  removeEventListener(type: "error" | "unhandledrejection", listener: (event: never) => void): void;
}

/**
 * The subset of Node's `process` a {@link globalHandlers} integration listens on and exits
 * through, typed structurally so this entry point never depends on `@types/node`.
 */
export interface GlobalProcess {
  on(event: "uncaughtException" | "unhandledRejection", listener: (value: never) => void): unknown;
  off(event: "uncaughtException" | "unhandledRejection", listener: (value: never) => void): unknown;
  exit(code: number): unknown;
}

export interface GlobalHandlersOptions {
  /** What a Node process does after an uncaught exception. The browser never exits and ignores it. */
  onUncaught: ExitPolicy;
  /** What a Node process does after an unhandled rejection. The browser never exits and ignores it. */
  onUnhandledRejection: ExitPolicy;
  /** How long an `"exit"` waits for the transport to flush. Defaults to 2000 ms; the browser ignores it. */
  flushTimeoutMs?: number;
  /**
   * Defaults to `globalThis` where it has an `addEventListener`. An injected target wins over
   * every process, injected or not.
   */
  eventTarget?: GlobalEventTarget;
  /**
   * Defaults to `globalThis.process` where the runtime has process exit hooks and `globalThis`
   * has no `addEventListener`. An injected process wins over `globalThis`, but not over an
   * injected {@link eventTarget}.
   */
  process?: GlobalProcess;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

/**
 * Creates an {@link Integration} that captures what nothing else caught, as `handled: false`
 * events under the `global.error` and `global.rejection` mechanisms.
 *
 * In the browser it listens for the `error` and `unhandledrejection` events on `globalThis`,
 * captures both at level `"error"`, and never calls `preventDefault`, so the browser still reports
 * each one to its own console. It never exits.
 *
 * In Node it listens for `uncaughtException` (captured at level `"fatal"`) and
 * `unhandledRejection` (at level `"error"`), always both: an unhandled rejection with no listener
 * of its own reaches `uncaughtException`. A listener switches off Node's own crash report and
 * exit, so the {@link ExitPolicy} for each decides what follows. `"exit"` writes the error to
 * `console.error`, waits up to `flushTimeoutMs` for the transport to flush, and exits with code 1
 * whether or not the flush finished. Another error with an `"exit"` policy while that flush is
 * pending exits at once, and the first event may not have reached its destination. `"continue"`
 * leaves the process running.
 *
 * An injected `eventTarget` is used first, then an injected `process`, then `globalThis` where it
 * has an `addEventListener`, then `globalThis.process`; a runtime with none of them installs
 * nothing. Its teardown removes every listener it added.
 */
export function globalHandlers(options: GlobalHandlersOptions): Integration {
  return {
    name: "globalHandlers",
    setup(host) {
      if (options.eventTarget !== undefined) {
        return installBrowserHandlers(options.eventTarget, host);
      }
      if (options.process !== undefined) {
        return installProcessHandlers(options.process, host, options);
      }
      const target = globalEventTarget();
      if (target !== undefined) {
        return installBrowserHandlers(target, host);
      }
      const process = globalProcess();
      if (process !== undefined) {
        return installProcessHandlers(process, host, options);
      }
      return undefined;
    },
  };
}

function globalEventTarget(): GlobalEventTarget | undefined {
  const candidate = globalThis as unknown as Partial<GlobalEventTarget>;
  return typeof candidate.addEventListener === "function" ? (candidate as GlobalEventTarget) : undefined;
}

/** `detectCapability` rules out a bundler's `process` polyfill, whose no-op `on` would install listeners that never fire. */
function globalProcess(): GlobalProcess | undefined {
  if (!detectCapability("processExitHooks")) {
    return undefined;
  }
  return (globalThis as unknown as { process: GlobalProcess }).process;
}

function installBrowserHandlers(target: GlobalEventTarget, host: IntegrationHost): () => void {
  const onError = (event: GlobalErrorEventLike) => {
    // A cross-origin script's error reaches the page with its `error` withheld; only the message survives.
    const error = event.error ?? new Error(event.message);
    host.capture(error, { mechanism: { handled: false, source: "global.error" }, level: "error" });
  };
  const onRejection = (event: GlobalRejectionEventLike) => {
    host.capture(event.reason, { mechanism: { handled: false, source: "global.rejection" }, level: "error" });
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

function installProcessHandlers(process: GlobalProcess, host: IntegrationHost, options: GlobalHandlersOptions): () => void {
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  let exiting = false;

  const handle = (error: unknown, level: Level, source: Mechanism["source"], policy: ExitPolicy) => {
    host.capture(error, { mechanism: { handled: false, source }, level });
    if (policy === "continue") {
      return;
    }
    // Node prints nothing once a listener is attached; a transport that does not write to the console would leave no trace of the crash.
    console.error(error);
    if (exiting) {
      process.exit(1);
      return;
    }
    exiting = true;
    void host
      .flush(flushTimeoutMs)
      .catch(() => false)
      .then(() => process.exit(1));
  };

  const onUncaught = (error: unknown) => handle(error, "fatal", "global.error", options.onUncaught);
  const onRejection = (reason: unknown) => handle(reason, "error", "global.rejection", options.onUnhandledRejection);

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);

  return () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejection);
  };
}
