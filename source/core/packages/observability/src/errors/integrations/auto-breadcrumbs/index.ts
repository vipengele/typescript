import { type Clock, systemClock } from "@vipengele/ts-core-common";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import type { Integration } from "../../integration";
import { ReporterConfigError } from "../../reporter-config-error";
import { type ClickTarget, installClicks } from "./clicks";
import { type ConsoleTarget, installConsole } from "./console";
import { type FetchTarget, installFetch } from "./fetch";
import { installNavigation, type NavigationTarget } from "./navigation";
import { DEFAULT_SELECTOR_ATTRIBUTES } from "./selector";
import { installXhr, type XhrTarget } from "./xhr";

/**
 * Console breadcrumbs' own options. There are none: `{}` turns the type on, like `true`, and the
 * shared `redaction` and `clock` sit on {@link AutoBreadcrumbsOptions}.
 */
export interface ConsoleBreadcrumbsOptions {
  readonly [option: string]: never;
}

/**
 * Fetch breadcrumbs' own options. There are none: `{}` turns the type on, like `true`, and the
 * shared `redaction` and `clock` sit on {@link AutoBreadcrumbsOptions}.
 */
export interface FetchBreadcrumbsOptions {
  readonly [option: string]: never;
}

/**
 * XHR breadcrumbs' own options. There are none: `{}` turns the type on, like `true`, and the
 * shared `redaction` and `clock` sit on {@link AutoBreadcrumbsOptions}.
 */
export interface XhrBreadcrumbsOptions {
  readonly [option: string]: never;
}

/**
 * Navigation breadcrumbs' own options. There are none: `{}` turns the type on, like `true`, and the
 * shared `redaction` and `clock` sit on {@link AutoBreadcrumbsOptions}.
 */
export interface NavigationBreadcrumbsOptions {
  readonly [option: string]: never;
}

/** Click breadcrumbs' own options. */
export interface ClickBreadcrumbsOptions {
  /**
   * The attributes each element of a click's selector renders, in this order. Defaults to
   * `["data-testid", "name", "aria-label", "title", "role"]`. `value` is never rendered, even when
   * listed.
   */
  readonly selectorAttributes?: readonly string[];
}

/**
 * What {@link autoBreadcrumbs} accepts. Each breadcrumb type is on by default wherever the runtime
 * has its global: `false` turns it off, and an options object turns it on and configures it.
 */
export interface AutoBreadcrumbsOptions {
  /** Each call to `console.debug`, `info`, `log`, `warn` and `error`, in category `"console"`. */
  readonly console?: boolean | ConsoleBreadcrumbsOptions;
  /** Each `fetch` request, in category `"http"`, recorded when it settles. */
  readonly fetch?: boolean | FetchBreadcrumbsOptions;
  /** Each `XMLHttpRequest`, in category `"http"`, recorded when it ends. Browser only. */
  readonly xhr?: boolean | XhrBreadcrumbsOptions;
  /** Each `history.pushState`, `replaceState` and `popstate` that changes the URL, in category `"navigation"`. Browser only. */
  readonly navigation?: boolean | NavigationBreadcrumbsOptions;
  /** Each click on the document, in category `"ui.click"`, as the clicked element's selector. Browser only. */
  readonly clicks?: boolean | ClickBreadcrumbsOptions;
  /** The policy every recorded URL is redacted with before it is stored. Defaults to `secretKeys`. */
  readonly redaction?: RedactionPolicy;
  /** Supplies each breadcrumb's `time` and each request's `duration_ms`. Defaults to `systemClock`. */
  readonly clock?: Clock;
}

/** The objects whose globals {@link createAutoBreadcrumbs} instruments, one per breadcrumb type. */
export interface AutoBreadcrumbsTargets {
  readonly console: ConsoleTarget | undefined;
  readonly fetch: FetchTarget | undefined;
  readonly xhr: XhrTarget | undefined;
  readonly navigation: NavigationTarget | undefined;
  readonly clicks: ClickTarget | undefined;
}

const TYPES = ["console", "fetch", "xhr", "navigation", "clicks"] as const;

type BreadcrumbType = (typeof TYPES)[number];

/** Every option resolved and frozen; a type set to `undefined` is off. */
interface Resolved {
  readonly clock: Clock;
  readonly redaction: RedactionPolicy;
  readonly enabled: Readonly<Record<BreadcrumbType, boolean>>;
  readonly selectorAttributes: readonly string[];
}

function describe(value: unknown): string {
  return `of type ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalArray(value: unknown): boolean {
  return value === undefined || Array.isArray(value);
}

/** A `RedactionPolicy` is an object whose `keys` is an array, with `except` and `detectors` arrays when present. */
function isRedactionPolicy(value: unknown): value is RedactionPolicy {
  return isRecord(value) && Array.isArray(value.keys) && isOptionalArray(value.except) && isOptionalArray(value.detectors);
}

function resolveToggle(type: BreadcrumbType, toggle: unknown): boolean {
  if (toggle === undefined) {
    return true;
  }
  if (typeof toggle === "boolean") {
    return toggle;
  }
  if (isRecord(toggle)) {
    return true;
  }
  throw new ReporterConfigError(`Invalid autoBreadcrumbs ${type} ${describe(toggle)}: expected a boolean or an options object.`);
}

function resolveSelectorAttributes(clicks: unknown): readonly string[] {
  const attributes = isRecord(clicks) ? clicks.selectorAttributes : undefined;
  if (attributes === undefined) {
    return DEFAULT_SELECTOR_ATTRIBUTES;
  }
  if (!Array.isArray(attributes)) {
    throw new ReporterConfigError(
      `Invalid autoBreadcrumbs clicks selectorAttributes ${describe(attributes)}: expected an array of strings.`,
    );
  }
  const copy = [...(attributes as unknown[])];
  for (const attribute of copy) {
    if (typeof attribute !== "string") {
      throw new ReporterConfigError(
        `Invalid autoBreadcrumbs clicks selectorAttributes entry ${describe(attribute)}: expected an array of strings.`,
      );
    }
  }
  return Object.freeze(copy as string[]);
}

function resolve(given: unknown): Resolved {
  const options = given === undefined ? {} : given;
  if (!isRecord(options)) {
    throw new ReporterConfigError(`Invalid autoBreadcrumbs options ${describe(options)}: expected an object.`);
  }
  const redaction = options.redaction === undefined ? secretKeys : options.redaction;
  if (!isRedactionPolicy(redaction)) {
    throw new ReporterConfigError(`Invalid autoBreadcrumbs redaction ${describe(redaction)}: expected a RedactionPolicy.`);
  }
  const clock = options.clock === undefined ? systemClock : options.clock;
  if (typeof clock !== "function") {
    throw new ReporterConfigError(`Invalid autoBreadcrumbs clock ${describe(clock)}: expected a function.`);
  }
  const enabled = {} as Record<BreadcrumbType, boolean>;
  for (const type of TYPES) {
    enabled[type] = resolveToggle(type, options[type]);
  }
  return Object.freeze({
    clock: clock as Clock,
    redaction,
    enabled: Object.freeze(enabled),
    selectorAttributes: resolveSelectorAttributes(options.clicks),
  });
}

function install(resolved: Resolved, targets: AutoBreadcrumbsTargets): (() => void)[] {
  const { clock, redaction, enabled, selectorAttributes } = resolved;
  const uninstalls: (() => void)[] = [];
  if (enabled.console) {
    uninstalls.push(installConsole(Object.freeze({ clock }), targets.console));
  }
  if (enabled.fetch) {
    uninstalls.push(installFetch(Object.freeze({ clock, redaction }), targets.fetch));
  }
  if (enabled.xhr) {
    uninstalls.push(installXhr(Object.freeze({ clock, redaction }), targets.xhr));
  }
  if (enabled.navigation) {
    uninstalls.push(installNavigation(Object.freeze({ clock, redaction }), targets.navigation));
  }
  if (enabled.clicks) {
    uninstalls.push(installClicks(Object.freeze({ clock, selectorAttributes }), targets.clicks));
  }
  return uninstalls;
}

/**
 * {@link autoBreadcrumbs}, instrumenting the globals `targets` gives rather than the realm's own.
 * `targets` is read at each `setup`.
 *
 * @throws {ReporterConfigError} As {@link autoBreadcrumbs} does.
 */
export function createAutoBreadcrumbs(options: AutoBreadcrumbsOptions | undefined, targets: () => AutoBreadcrumbsTargets): Integration {
  const resolved = resolve(options);
  return {
    name: "autoBreadcrumbs",
    setup() {
      const uninstalls = install(resolved, targets());
      // Each uninstall leaves its type's install list at most once and never throws (`registry.ts`).
      return () => {
        for (const uninstall of uninstalls.splice(0)) {
          uninstall();
        }
      };
    },
  };
}

function realmTargets(): AutoBreadcrumbsTargets {
  return { console: globalThis.console, fetch: globalThis, xhr: globalThis, navigation: globalThis, clicks: globalThis };
}

/**
 * Creates an {@link Integration} that records Breadcrumbs from the runtime's own globals into the
 * current Unit of Work's trail: console calls, `fetch` and `XMLHttpRequest` requests, `history`
 * navigations and clicks on the document. Each type is on wherever the runtime has its global and
 * is skipped silently where it does not, so in Node only console and fetch install.
 *
 * Every URL a breadcrumb records is redacted with `redaction` before it is stored. A click is
 * recorded as the clicked element's selector, built from tag names, ids, classes and the listed
 * attributes; an element's text and an input's value are never read. The package's own console
 * output and requests are never recorded.
 *
 * Each global is wrapped at most once per realm, however many Reporters or copies of the package
 * install this integration, so every event is recorded once. The oldest live install's
 * `redaction`, `clock` and type options apply. The integration's teardown leaves the instrumentation
 * of every type it installed; the last Reporter to leave restores each original global, unless
 * something else has wrapped it since.
 *
 * @throws {ReporterConfigError} When `options` is not an object; a type's toggle is neither a
 * boolean nor an object; `clicks.selectorAttributes` is not an array of strings; `redaction` is not
 * a `RedactionPolicy`; or `clock` is not a function.
 */
export function autoBreadcrumbs(options?: AutoBreadcrumbsOptions): Integration {
  return createAutoBreadcrumbs(options, realmTargets);
}
