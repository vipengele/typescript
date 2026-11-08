import { type Clock, type Level, systemClock } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import { breadcrumbsSuppressed } from "../../../breadcrumb-suppression";
import { install, patchProperties } from "./registry";

/** The `console` methods the console instrumentation wraps. */
export const CONSOLE_METHODS = ["debug", "info", "log", "warn", "error"] as const;

export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

/** The level each wrapped method records its breadcrumb at. */
const LEVELS: Readonly<Record<ConsoleMethod, Level>> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  error: "error",
};

/**
 * The console instrumentation's options, as an install puts them in the realm's install list. An
 * entry from another copy of the package may lack a field; a missing or non-function `clock` reads
 * as `systemClock`.
 */
export interface ConsoleInstrumentationOptions {
  /** Supplies each breadcrumb's `time`. */
  readonly clock: Clock;
}

/** The object whose methods are wrapped: `console`, or a stand-in with the same methods. */
export interface ConsoleTarget {
  debug?(...args: unknown[]): unknown;
  info?(...args: unknown[]): unknown;
  log?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  error?(...args: unknown[]): unknown;
}

/** The most UTF-16 code units a console breadcrumb's message keeps. */
const MAX_MESSAGE_LENGTH = 1000;

/** The most values `JSON.stringify` visits for one argument before it leaves the rest out. */
const MAX_JSON_NODES = 200;

/** Stands in for an argument that neither `JSON.stringify` nor `String` can render. */
const UNRENDERABLE = "[unrenderable]";

/** Each visited value's share of the JSON budget beyond its key and its own text: quotes, colon, comma. */
const JSON_NODE_OVERHEAD = 4;

/** Roughly how many characters `nested` adds to JSON text once its strings are cut at `budget`. */
function jsonSize(key: string, nested: unknown, budget: number): number {
  const own =
    typeof nested === "string"
      ? Math.min(nested.length, budget)
      : typeof nested === "object" && nested !== null
        ? 2
        : String(nested).length;
  return key.length + own + JSON_NODE_OVERHEAD;
}

/**
 * `value` as JSON text written for at most about `budget` characters: each string is cut to `budget`,
 * and once the estimated text reaches `budget`, or {@link MAX_JSON_NODES} values have been visited,
 * every later value is left out without being descended into. The root value is always kept.
 */
function boundedJson(value: unknown, budget: number): string | undefined {
  let visited = 0;
  let size = 0;
  return JSON.stringify(value, (key: string, nested: unknown) => {
    visited += 1;
    if (visited > MAX_JSON_NODES || size >= budget) {
      return undefined;
    }
    size += jsonSize(key, nested, budget);
    return typeof nested === "string" && nested.length > budget ? nested.slice(0, budget) : nested;
  });
}

/**
 * One argument as message text of at most `budget` characters: a string as it is, an `Error` as
 * `name: message`, anything else as bounded JSON, or through `String` when JSON gives nothing or
 * throws (a cycle, a `bigint`). A string is sliced, never copied whole.
 */
function render(value: unknown, budget: number): string {
  try {
    if (typeof value === "string") {
      return value.slice(0, budget);
    }
    if (value instanceof Error) {
      return `${String(value.name).slice(0, budget)}: ${String(value.message).slice(0, budget)}`.slice(0, budget);
    }
    try {
      const json = boundedJson(value, budget);
      if (json !== undefined) {
        return json.slice(0, budget);
      }
    } catch {
      // Rendered through `String` below.
    }
    return String(value).slice(0, budget);
  } catch {
    return UNRENDERABLE;
  }
}

/**
 * The arguments rendered and joined by a space, cut at {@link MAX_MESSAGE_LENGTH}. Each argument is
 * rendered within what is left of the cap, and rendering stops once the cap is reached.
 */
function messageOf(args: readonly unknown[]): string {
  let message = "";
  for (const [index, arg] of args.entries()) {
    if (index > 0) {
      message += " ";
    }
    if (message.length >= MAX_MESSAGE_LENGTH) {
      break;
    }
    message += render(arg, MAX_MESSAGE_LENGTH - message.length);
  }
  return message.slice(0, MAX_MESSAGE_LENGTH);
}

/** Records the breadcrumb for one call of `method`, unless suppressed or the patch is not current. Never throws. */
function record(options: () => ConsoleInstrumentationOptions | undefined, method: ConsoleMethod, args: readonly unknown[]): void {
  try {
    if (breadcrumbsSuppressed()) {
      return;
    }
    const active = options();
    if (active === undefined) {
      return;
    }
    const clock = typeof active.clock === "function" ? active.clock : systemClock;
    Scope.addBreadcrumb({ category: "console", level: LEVELS[method], message: messageOf(args), time: clock() });
  } catch {
    // The call goes ahead without a breadcrumb.
  }
}

/**
 * Joins the realm's console instrumentation with `options` and returns the function that leaves
 * it. While the patch is current, each of {@link CONSOLE_METHODS} on `target` records a breadcrumb
 * in category `"console"` before calling the original with the same `this` and arguments, and
 * returns or throws what the original does. The message is stored as rendered, not redacted: like a
 * crumb given to `Scope.addBreadcrumb`, it is redacted when an event attaches the trail, by the
 * Reporter's redaction stage. A method that is missing or cannot be assigned is left
 * as it is while the others are patched; a `target` that is not an object installs nothing.
 */
export function installConsole(options: ConsoleInstrumentationOptions, target: ConsoleTarget | undefined = globalThis.console): () => void {
  if (typeof target !== "object" || target === null) {
    return () => {};
  }
  return install<ConsoleInstrumentationOptions>("console", options, (read) =>
    patchProperties(target, CONSOLE_METHODS, (original, key) => {
      const method = key as ConsoleMethod;
      return function (this: unknown, ...args: never[]): unknown {
        record(read, method, args);
        return original.apply(this, args);
      };
    }),
  );
}
