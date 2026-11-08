import { type Clock, systemClock } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import { breadcrumbsSuppressed } from "../../../breadcrumb-suppression";
import { install } from "./registry";
import { DEFAULT_SELECTOR_ATTRIBUTES, renderSelector } from "./selector";

/**
 * The click instrumentation's options, as an install puts them in the realm's install list. An
 * entry from another copy of the package may lack a field; a missing or non-function `clock` reads
 * as `systemClock`, and a missing or non-array `selectorAttributes` as
 * {@link DEFAULT_SELECTOR_ATTRIBUTES}.
 */
export interface ClickInstrumentationOptions {
  /** Supplies each breadcrumb's `time`. */
  readonly clock: Clock;
  /** The attributes each element of the selector renders, in order; `value` is never rendered. */
  readonly selectorAttributes: readonly string[];
}

/** The object whose `document` is listened on: `globalThis`, or a stand-in holding one. */
export interface ClickTarget {
  document?: unknown;
}

interface ListenerTarget {
  addEventListener(type: string, listener: (event: unknown) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: unknown) => void, capture: boolean): void;
}

function isListenerTarget(value: unknown): value is ListenerTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ListenerTarget).addEventListener === "function" &&
    typeof (value as ListenerTarget).removeEventListener === "function"
  );
}

/**
 * The element a click landed on: the event's target when it is an element, the parent element of
 * a target that is not one (a text node), or `undefined` when there is none (the document itself).
 */
function clickedElement(event: unknown): unknown {
  const target = (event as { target?: unknown } | null | undefined)?.target;
  if (typeof target !== "object" || target === null) {
    return undefined;
  }
  return typeof (target as { tagName?: unknown }).tagName === "string" ? target : (target as { parentElement?: unknown }).parentElement;
}

/** Records the breadcrumb for one click, unless suppressed, the patch is not current, or no element was clicked. Never throws. */
function record(options: () => ClickInstrumentationOptions | undefined, event: unknown): void {
  try {
    if (breadcrumbsSuppressed()) {
      return;
    }
    const active = options();
    if (active === undefined) {
      return;
    }
    const attributes = Array.isArray(active.selectorAttributes) ? active.selectorAttributes : DEFAULT_SELECTOR_ATTRIBUTES;
    const selector = renderSelector(clickedElement(event), attributes);
    if (selector === "") {
      return;
    }
    const clock = typeof active.clock === "function" ? active.clock : systemClock;
    Scope.addBreadcrumb({ category: "ui.click", level: "info", message: selector, time: clock() });
  } catch {
    // The click goes ahead without a breadcrumb.
  }
}

/**
 * Joins the realm's click instrumentation with `options` and returns the function that leaves it.
 * The patch is one capture-phase `click` listener on `target.document`. While it is current, a
 * click records a breadcrumb in category `"ui.click"` at `info`, with no `data`, whose message is
 * the clicked element's selector ({@link renderSelector}); a click whose target is a text node
 * renders its parent element, and one with no element to render records nothing. The selector is
 * built from tag names, ids, classes and the listed attributes alone: an element's text and an
 * input's value are never read. The options and the suppression flag are read when the click is
 * dispatched. A `target` with no `document` that takes listeners, as in Node, installs nothing.
 */
export function installClicks(options: ClickInstrumentationOptions, target: ClickTarget | undefined = globalThis): () => void {
  let document: unknown;
  try {
    document = typeof target === "object" && target !== null ? target.document : undefined;
  } catch {
    document = undefined;
  }
  if (!isListenerTarget(document)) {
    return () => {};
  }
  const listened = document;
  return install<ClickInstrumentationOptions>("clicks", options, (read) => {
    const onClick = (event: unknown): void => record(read, event);
    listened.addEventListener("click", onClick, true);
    return () => {
      listened.removeEventListener("click", onClick, true);
    };
  });
}
