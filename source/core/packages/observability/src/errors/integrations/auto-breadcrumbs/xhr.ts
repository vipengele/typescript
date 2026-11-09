import { type Clock, type Level, systemClock } from "@vipengele/ts-core-common";
import { type BreadcrumbInput, Scope } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { breadcrumbsSuppressed } from "../../../breadcrumb-suppression";
import { install, patchProperties } from "./registry";
import { redactBreadcrumbUrl } from "./url";

/**
 * The XHR instrumentation's options, as an install puts them in the realm's install list. An entry
 * from another copy of the package may lack a field; a missing or non-function `clock` reads as
 * `systemClock`, and a missing or non-object `redaction` as `secretKeys`.
 */
export interface XhrInstrumentationOptions {
  /** Supplies each breadcrumb's `time` and the request's `duration_ms`. */
  readonly clock: Clock;
  /** The policy the request URL is redacted with before it is recorded. */
  readonly redaction: RedactionPolicy;
}

/** The object whose `XMLHttpRequest` is instrumented: `globalThis`, or a stand-in holding one. */
export interface XhrTarget {
  XMLHttpRequest?: unknown;
}

/**
 * The `data.error` of a request that ended with status 0: the request failed on the network, was
 * aborted or timed out, and `XMLHttpRequest` gives no response status to record.
 */
export const XHR_NETWORK_ERROR = "NetworkError";

/** What `open` was last called with on an instance. A new object per `open`, so its identity marks the request. */
interface Opened {
  readonly method: string;
  readonly url: string;
}

/**
 * The last `open` of each instrumented instance. Weakly held, so an instance that is collected
 * takes its entry with it.
 */
const opened = new WeakMap<object, Opened | undefined>();

/** What a request carries from its `send` to its `loadend`: everything read when it was sent. */
interface Started {
  readonly opened: Opened;
  readonly clock: Clock;
  readonly url: string;
  readonly start: number;
  /** Records into the scope current when the request was sent, wherever it ends. */
  readonly record: (input: BreadcrumbInput) => void;
}

interface LoadEndTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly status?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Remembers the method, upper-cased, and the URL's string form `open(method, url)` was called with
 * on `xhr`, replacing what an earlier `open` left. A request sent before this `open` no longer
 * matches and records nothing when it ends: re-opening an instance ends its request without a
 * response. Never throws; arguments that cannot be read leave the instance with no request.
 */
function remember(xhr: unknown, args: readonly unknown[]): void {
  try {
    opened.delete(xhr as object);
    opened.set(xhr as object, { method: String(args[0]).toUpperCase(), url: String(args[1]) });
  } catch {
    // `send` finds no request for this instance and records nothing.
  }
}

/**
 * Reads everything the request's breadcrumb needs when `send` is called, or `undefined` when it
 * records nothing: sent while suppressed, sent while the patch is not current, or sent on an
 * instance with no remembered `open`. Never throws.
 */
function begin(options: () => XhrInstrumentationOptions | undefined, xhr: unknown): Started | undefined {
  try {
    if (breadcrumbsSuppressed()) {
      return undefined;
    }
    const active = options();
    if (active === undefined) {
      return undefined;
    }
    const request = opened.get(xhr as object);
    if (request === undefined) {
      return undefined;
    }
    const clock = typeof active.clock === "function" ? active.clock : systemClock;
    const policy = isObject(active.redaction) ? active.redaction : secretKeys;
    return {
      opened: request,
      clock,
      url: redactBreadcrumbUrl(request.url, policy),
      start: clock(),
      record: Scope.propagate((input: BreadcrumbInput) => Scope.addBreadcrumb(input)),
    };
  } catch {
    return undefined;
  }
}

function levelFor(status: number | undefined): Level {
  if (status === undefined) {
    return "info";
  }
  return status >= 500 ? "error" : status >= 400 ? "warn" : "info";
}

function statusOf(xhr: LoadEndTarget): number | undefined {
  try {
    const status = xhr.status;
    return typeof status === "number" ? status : undefined;
  } catch {
    return undefined;
  }
}

/** Records the ended request's breadcrumb with what it read when it was sent. Never throws. */
function finish(started: Started, status: number | undefined): void {
  try {
    const time = started.clock();
    const { method } = started.opened;
    const failed = status === 0;
    started.record({
      category: "http",
      level: failed ? "error" : levelFor(status),
      message: `${method} ${started.url}`,
      time,
      data: {
        method,
        url: started.url,
        ...(status !== undefined && !failed ? { status_code: status } : {}),
        duration_ms: time - started.start,
        ...(failed ? { error: XHR_NETWORK_ERROR } : {}),
      },
    });
  } catch {
    // The request ends without a breadcrumb.
  }
}

function detach(xhr: LoadEndTarget, listener: () => void): void {
  try {
    xhr.removeEventListener("loadend", listener);
  } catch {
    // The listener stays attached; it records at most once and never for a later request.
  }
}

/**
 * Adds the `loadend` listener that records `started`'s breadcrumb and returns the function that
 * removes it, or `undefined` when it could not be added. The listener removes itself when it fires,
 * records at most once, and records nothing when the instance has been re-opened since `send`.
 */
function listen(xhr: unknown, started: Started): (() => void) | undefined {
  try {
    const target = xhr as LoadEndTarget;
    let fired = false;
    const onLoadEnd = (): void => {
      detach(target, onLoadEnd);
      if (fired || opened.get(target) !== started.opened) {
        return;
      }
      fired = true;
      finish(started, statusOf(target));
    };
    target.addEventListener("loadend", onLoadEnd);
    return () => detach(target, onLoadEnd);
  } catch {
    return undefined;
  }
}

/**
 * Joins the realm's XHR instrumentation with `options` and returns the function that leaves it.
 * `XMLHttpRequest.prototype.open` and `.send` are each patched on their own, and either is left as
 * it is when it cannot be assigned. While the patch is current, a request records one breadcrumb in
 * category `"http"` when it fires `loadend`: `"<METHOD> <redacted url>"`, with `method`, `url`,
 * `status_code` and `duration_ms` in `data`, at `warn` for a status of 400 or more, `error` for 500
 * or more, `info` otherwise. A status of 0 — a network failure, an abort or a timeout — records at
 * `error` with no `status_code` and {@link XHR_NETWORK_ERROR} as `data.error`.
 *
 * The method and URL are read at `open`; the options, the suppression flag, the start time and the
 * current scope at `send`. A request sent while suppressed records nothing, and one ending after
 * every install is torn down still records, with the options it was sent under. Re-opening an
 * instance drops the breadcrumb of the request it was carrying. The originals are called with the
 * same `this` and arguments and return or throw what they do; a `send` that throws records nothing.
 * A `target` with no `XMLHttpRequest` constructor, as in Node, installs nothing.
 */
export function installXhr(options: XhrInstrumentationOptions, target: XhrTarget | undefined = globalThis): () => void {
  let prototype: unknown;
  try {
    const xhrClass = isObject(target) ? target.XMLHttpRequest : undefined;
    prototype = typeof xhrClass === "function" ? (xhrClass as { prototype?: unknown }).prototype : undefined;
  } catch {
    prototype = undefined;
  }
  if (!isObject(prototype)) {
    return () => {};
  }
  return install<XhrInstrumentationOptions>("xhr", options, (read) =>
    patchProperties(prototype, ["open", "send"], (original, key) => {
      if (key === "open") {
        return function (this: unknown, ...args: never[]): unknown {
          const result = original.apply(this, args);
          remember(this, args);
          return result;
        };
      }
      return function (this: unknown, ...args: never[]): unknown {
        const started = begin(read, this);
        const stop = started === undefined ? undefined : listen(this, started);
        try {
          return original.apply(this, args);
        } catch (error) {
          stop?.();
          throw error;
        }
      };
    }),
  );
}
