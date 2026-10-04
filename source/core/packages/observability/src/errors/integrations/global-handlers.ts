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

export interface GlobalHandlersOptions {
  /** What a Node process does after an uncaught exception. The browser never exits and ignores it. */
  onUncaught: ExitPolicy;
  /** What a Node process does after an unhandled rejection. The browser never exits and ignores it. */
  onUnhandledRejection: ExitPolicy;
  /** How long an `"exit"` waits for the transport to flush. Defaults to 2000 ms; the browser ignores it. */
  flushTimeoutMs?: number;
  /** Defaults to `globalThis` where it has an `addEventListener`. */
  eventTarget?: GlobalEventTarget;
}

/**
 * Creates an {@link Integration} that captures what nothing else caught: in the browser, the
 * `error` and `unhandledrejection` events on `globalThis`, as `handled: false` events at level
 * `"error"` under the `global.error` and `global.rejection` mechanisms. It never calls
 * `preventDefault`, so the browser still reports each one to its own console. A runtime it has
 * no listener for installs nothing. Its teardown removes every listener it added.
 */
export function globalHandlers(options: GlobalHandlersOptions): Integration {
  return {
    name: "globalHandlers",
    setup(host) {
      const target = options.eventTarget ?? globalEventTarget();
      if (target !== undefined) {
        return installBrowserHandlers(target, host);
      }
      return undefined;
    },
  };
}

function globalEventTarget(): GlobalEventTarget | undefined {
  const candidate = globalThis as unknown as Partial<GlobalEventTarget>;
  return typeof candidate.addEventListener === "function" ? (candidate as GlobalEventTarget) : undefined;
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
