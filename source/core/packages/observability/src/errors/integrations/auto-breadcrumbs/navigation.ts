import { type Clock, systemClock } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { breadcrumbsSuppressed } from "../../../breadcrumb-suppression";
import { install, patchProperties, type Restore } from "./registry";
import { redactBreadcrumbUrl } from "./url";

/**
 * The navigation instrumentation's options, as an install puts them in the realm's install list.
 * An entry from another copy of the package may lack a field; a missing or non-function `clock`
 * reads as `systemClock`, and a missing or non-object `redaction` as `secretKeys`.
 */
export interface NavigationInstrumentationOptions {
  /** Supplies each breadcrumb's `time`. */
  readonly clock: Clock;
  /** The policy both URLs are redacted with before they are recorded. */
  readonly redaction: RedactionPolicy;
}

/**
 * The object whose navigations are instrumented: `globalThis`, or a stand-in holding a `history`,
 * the `location` it moves, and the `addEventListener`/`removeEventListener` `popstate` fires on.
 */
export interface NavigationTarget {
  history?: unknown;
  location?: unknown;
  addEventListener?: unknown;
  removeEventListener?: unknown;
}

/** The `history` methods wrapped. */
const HISTORY_METHODS = ["pushState", "replaceState"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The location's `href`, or `undefined` when it is not a string or reading it throws. */
function hrefOf(location: Record<string, unknown>): string | undefined {
  try {
    const href = location.href;
    return typeof href === "string" ? href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records a navigation from `from` to `to`, unless either is unknown, they are the same URL, it is
 * suppressed, or the patch is not current. Never throws.
 */
function record(options: () => NavigationInstrumentationOptions | undefined, from: string | undefined, to: string | undefined): void {
  try {
    if (from === undefined || to === undefined || from === to || breadcrumbsSuppressed()) {
      return;
    }
    const active = options();
    if (active === undefined) {
      return;
    }
    const clock = typeof active.clock === "function" ? active.clock : systemClock;
    const policy = isObject(active.redaction) ? active.redaction : secretKeys;
    const redactedFrom = redactBreadcrumbUrl(from, policy);
    const redactedTo = redactBreadcrumbUrl(to, policy);
    Scope.addBreadcrumb({
      category: "navigation",
      level: "info",
      message: `${redactedFrom} → ${redactedTo}`,
      time: clock(),
      data: { from: redactedFrom, to: redactedTo },
    });
  } catch {
    // The navigation goes ahead without a breadcrumb.
  }
}

interface PopStateTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function readPart(target: NavigationTarget, key: keyof NavigationTarget): unknown {
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

/**
 * Joins the realm's navigation instrumentation with `options` and returns the function that leaves
 * it. While the patch is current, a navigation records a breadcrumb in category `"navigation"` at
 * `info`, with `{ from, to }` in `data` and `"<from> → <to>"` as its message, both URLs redacted
 * with the options' policy. A navigation that stays on the same URL records nothing.
 *
 * `history.pushState` and `.replaceState` are each patched on their own, and either is left as it
 * is when it cannot be assigned. Each calls the original with the same `this` and arguments and
 * returns or throws what it does; `from` is `location.href` before the call and `to` the
 * `location.href` it leaves, so a relative URL is recorded resolved. A call that throws records
 * nothing. A `popstate` listener on `target` records the move from the last URL the patch saw to
 * `location.href`. The patch keeps that last-known URL itself, starting from `location.href` when it
 * is installed and following every navigation it observes, recorded or not.
 *
 * The options and the suppression flag are read when the navigation happens. A `target` with no
 * `location`, as in Node, installs nothing; one with no `history`, or no listener methods, installs
 * only the other half.
 */
export function installNavigation(
  options: NavigationInstrumentationOptions,
  target: NavigationTarget | undefined = globalThis,
): () => void {
  if (!isObject(target)) {
    return () => {};
  }
  const location = readPart(target, "location");
  if (!isObject(location)) {
    return () => {};
  }
  const history = readPart(target, "history");
  const listens =
    typeof readPart(target, "addEventListener") === "function" && typeof readPart(target, "removeEventListener") === "function";
  return install<NavigationInstrumentationOptions>("navigation", options, (read) => {
    let lastUrl = hrefOf(location);

    const restoreHistory = isObject(history)
      ? patchProperties(
          history,
          HISTORY_METHODS,
          (original) =>
            function (this: unknown, ...args: never[]): unknown {
              const from = hrefOf(location);
              const result = original.apply(this, args);
              const to = hrefOf(location);
              lastUrl = to ?? lastUrl;
              record(read, from, to);
              return result;
            },
        )
      : undefined;

    let removeListener: Restore | undefined;
    if (listens) {
      const events = target as unknown as PopStateTarget;
      const onPopState = (): void => {
        const from = lastUrl;
        const to = hrefOf(location);
        lastUrl = to ?? lastUrl;
        record(read, from, to);
      };
      try {
        events.addEventListener("popstate", onPopState);
        removeListener = () => events.removeEventListener("popstate", onPopState);
      } catch {
        removeListener = undefined;
      }
    }

    if (restoreHistory === undefined && removeListener === undefined) {
      return undefined;
    }
    return () => {
      restoreHistory?.();
      try {
        removeListener?.();
      } catch {
        // The listener stays attached, inert once the patch is not current.
      }
    };
  });
}
