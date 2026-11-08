import { type Clock, type Level, systemClock } from "@vipengele/ts-core-common";
import { type BreadcrumbInput, Scope } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { breadcrumbsSuppressed } from "../../../breadcrumb-suppression";
import { install, patchProperties } from "./registry";
import { redactBreadcrumbUrl } from "./url";

/**
 * The fetch instrumentation's options, as an install puts them in the realm's install list. An
 * entry from another copy of the package may lack a field; a missing or non-function `clock` reads
 * as `systemClock`, and a missing or non-object `redaction` as `secretKeys`.
 */
export interface FetchInstrumentationOptions {
  /** Supplies each breadcrumb's `time` and the request's `duration_ms`. */
  readonly clock: Clock;
  /** The policy the request URL is redacted with before it is recorded. */
  readonly redaction: RedactionPolicy;
}

/** The object whose `fetch` is wrapped: `globalThis`, or a stand-in holding a `fetch`. */
export interface FetchTarget {
  fetch?(...args: unknown[]): unknown;
}

/** What a request carries from its call to its settlement: everything read when it started. */
interface Started {
  readonly clock: Clock;
  readonly method: string;
  readonly url: string;
  readonly start: number;
  /** Records into the scope current when the request started, wherever it settles. */
  readonly record: (input: BreadcrumbInput) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The method and URL of a `fetch(input, init)` call. `init.method` overrides the method a `Request`
 * carries, and either defaults to `GET`. A `Request` gives its `url`; a `URL`, or anything else,
 * its string form.
 */
function describe(input: unknown, init: unknown): { method: string; url: string } {
  const initMethod = isObject(init) ? init.method : undefined;
  const inputMethod = isObject(input) ? input.method : undefined;
  const method = typeof initMethod === "string" ? initMethod : typeof inputMethod === "string" ? inputMethod : "GET";
  const inputUrl = isObject(input) ? input.url : undefined;
  const url = typeof input === "string" ? input : typeof inputUrl === "string" ? inputUrl : String(input);
  return { method: method.toUpperCase(), url };
}

/**
 * Reads everything the request's breadcrumb needs when the call starts, or `undefined` when it
 * records nothing: called while suppressed, called while the patch is not current, or failing to
 * read its own arguments. Never throws.
 */
function begin(options: () => FetchInstrumentationOptions | undefined, args: readonly unknown[]): Started | undefined {
  try {
    if (breadcrumbsSuppressed()) {
      return undefined;
    }
    const active = options();
    if (active === undefined) {
      return undefined;
    }
    const clock = typeof active.clock === "function" ? active.clock : systemClock;
    const policy = isObject(active.redaction) ? active.redaction : secretKeys;
    const { method, url } = describe(args[0], args[1]);
    return {
      clock,
      method,
      url: redactBreadcrumbUrl(url, policy),
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

/** Records the settled request's breadcrumb with what it read when it started. Never throws. */
function finish(started: Started, outcome: { status?: number; error?: string }): void {
  try {
    const time = started.clock();
    const { status, error } = outcome;
    started.record({
      category: "http",
      level: error !== undefined ? "error" : levelFor(status),
      message: `${started.method} ${started.url}`,
      time,
      data: {
        method: started.method,
        url: started.url,
        ...(status !== undefined ? { status_code: status } : {}),
        duration_ms: time - started.start,
        ...(error !== undefined ? { error } : {}),
      },
    });
  } catch {
    // The settlement passes through without a breadcrumb.
  }
}

function statusOf(response: unknown): number | undefined {
  try {
    const status = isObject(response) ? response.status : undefined;
    return typeof status === "number" ? status : undefined;
  } catch {
    return undefined;
  }
}

function errorNameOf(error: unknown): string {
  try {
    const name = isObject(error) ? error.name : undefined;
    return typeof name === "string" ? name : "Error";
  } catch {
    return "Error";
  }
}

/**
 * Chains the breadcrumb onto `result` when it is a thenable, returning a promise that resolves to
 * the same value or rejects with the same reason. Anything else, or a thenable whose `then` fails to
 * chain, is returned as it is, unrecorded.
 */
function observe(result: unknown, started: Started): unknown {
  try {
    const then = isObject(result) ? result.then : undefined;
    if (typeof then !== "function") {
      return result;
    }
    return then.call(
      result,
      (response: unknown) => {
        finish(started, { status: statusOf(response) });
        return response;
      },
      (error: unknown) => {
        finish(started, { error: errorNameOf(error) });
        throw error;
      },
    );
  } catch {
    return result;
  }
}

/**
 * Joins the realm's fetch instrumentation with `options` and returns the function that leaves it.
 * While the patch is current, `target.fetch` records one breadcrumb in category `"http"` when the
 * request settles: `"<METHOD> <redacted url>"`, with `method`, `url`, `status_code` and
 * `duration_ms` in `data`, at `error` for a rejection (with the error's name as `data.error`) or a
 * status of 500 or more, `warn` for 400 or more, `info` otherwise.
 *
 * The options, the suppression flag and the current scope are read when `fetch` is called: a
 * request started while suppressed records nothing, and one settling after every install is torn
 * down still records, with the options it started under. The original is called with the same
 * `this` and arguments; its result settles the same way through the wrapper, and a synchronous
 * throw propagates unrecorded. A `target` that is not an object, or whose `fetch` is missing or
 * cannot be assigned, installs nothing.
 */
export function installFetch(options: FetchInstrumentationOptions, target: FetchTarget | undefined = globalThis): () => void {
  if (typeof target !== "object" || target === null) {
    return () => {};
  }
  return install<FetchInstrumentationOptions>("fetch", options, (read) =>
    patchProperties(target, ["fetch"], (original) => {
      return function (this: unknown, ...args: never[]): unknown {
        const started = begin(read, args);
        const result = original.apply(this, args);
        return started === undefined ? result : observe(result, started);
      };
    }),
  );
}
