// biome-ignore-all lint/security/noSecrets: every fixture is a URL or a CSS selector, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test } from "vitest";
import type { IntegrationHost } from "../../integration";
import { createReporter } from "../../reporter";
import { isReporterConfigError } from "../../reporter-config-error";
import { type AutoBreadcrumbsOptions, type AutoBreadcrumbsTargets, autoBreadcrumbs, createAutoBreadcrumbs } from "./index";
import { activeOptions, type InstrumentationType } from "./registry";

const TYPES: readonly InstrumentationType[] = ["console", "fetch", "xhr", "navigation", "clicks"];

const host: IntegrationHost = { capture: () => "id", flush: async () => true };

const teardowns: (() => void)[] = [];

afterEach(() => {
  for (const teardown of teardowns.splice(0)) {
    teardown();
  }
});

type Listener = (event: unknown) => void;

/** A stand-in for each global the integration instruments, fresh per test. */
function fakeTargets() {
  const consoleCalls: unknown[][] = [];
  const consoleTarget = {
    debug: (...args: unknown[]) => consoleCalls.push(args),
    info: (...args: unknown[]) => consoleCalls.push(args),
    log: (...args: unknown[]) => consoleCalls.push(args),
    warn: (...args: unknown[]) => consoleCalls.push(args),
    error: (...args: unknown[]) => consoleCalls.push(args),
  };
  const fetchTarget = { fetch: async () => ({ status: 200 }) };
  class FakeXhr {
    open(): void {}
    send(): void {}
  }
  const location = { href: "https://app.example.com/" };
  const history = {
    pushState(_state: unknown, _unused: string, url: string) {
      location.href = url;
    },
    replaceState(_state: unknown, _unused: string, url: string) {
      location.href = url;
    },
  };
  const popListeners = new Set<Listener>();
  const navigationTarget = {
    history,
    location,
    addEventListener: (_type: string, listener: Listener) => popListeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => popListeners.delete(listener),
  };
  const clickListeners = new Set<Listener>();
  const document = {
    addEventListener: (_type: string, listener: Listener) => clickListeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => clickListeners.delete(listener),
    click(target: unknown) {
      for (const listener of [...clickListeners]) {
        listener({ target });
      }
    },
  };
  const targets: AutoBreadcrumbsTargets = {
    console: consoleTarget,
    fetch: fetchTarget,
    xhr: { XMLHttpRequest: FakeXhr },
    navigation: navigationTarget,
    clicks: { document },
  };
  const originals = {
    log: consoleTarget.log,
    fetch: fetchTarget.fetch,
    open: FakeXhr.prototype.open,
    send: FakeXhr.prototype.send,
    pushState: history.pushState,
    replaceState: history.replaceState,
  };
  /** Whether each instrumented property still holds its original, and how many listeners are attached. */
  const state = () => ({
    log: consoleTarget.log === originals.log,
    fetch: fetchTarget.fetch === originals.fetch,
    open: FakeXhr.prototype.open === originals.open,
    send: FakeXhr.prototype.send === originals.send,
    pushState: history.pushState === originals.pushState,
    replaceState: history.replaceState === originals.replaceState,
    popstate: popListeners.size,
    click: clickListeners.size,
  });
  return { targets, consoleTarget, history, document, consoleCalls, state };
}

const UNTOUCHED = { log: true, fetch: true, open: true, send: true, pushState: true, replaceState: true, popstate: 0, click: 0 };
const INSTRUMENTED = { log: false, fetch: false, open: false, send: false, pushState: false, replaceState: false, popstate: 1, click: 1 };

function setUp(options: AutoBreadcrumbsOptions | undefined, targets: AutoBreadcrumbsTargets): () => void {
  const teardown = createAutoBreadcrumbs(options, () => targets).setup(host) as () => void;
  teardowns.push(teardown);
  return teardown;
}

function element(tagName: string, attributes: Record<string, string> = {}) {
  return { tagName, parentElement: null, getAttribute: (name: string) => attributes[name] ?? null };
}

/** Runs `fn` in a fresh Unit of Work, synchronously, and returns the trail it left. */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

function configError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("autoBreadcrumbs", () => {
  test("is an integration named autoBreadcrumbs", () => {
    expect(autoBreadcrumbs().name).toBe("autoBreadcrumbs");
    expect(createAutoBreadcrumbs(undefined, () => fakeTargets().targets).name).toBe("autoBreadcrumbs");
  });

  test("installs every type by default and records through each with the clock", () => {
    const time = createManualTime(9_000);
    const fake = fakeTargets();
    setUp({ clock: time.clock }, fake.targets);

    expect(fake.state()).toEqual(INSTRUMENTED);
    const trail = trailOf(() => {
      fake.consoleTarget.log("hello");
      fake.history.pushState(null, "", "https://app.example.com/next");
      fake.document.click(element("BUTTON", { id: "save" }));
    });

    expect(fake.consoleCalls).toEqual([["hello"]]);
    expect(trail).toEqual([
      { time: 9_000, category: "console", level: "info", message: "hello" },
      {
        time: 9_000,
        category: "navigation",
        level: "info",
        message: "https://app.example.com/ → https://app.example.com/next",
        data: { from: "https://app.example.com/", to: "https://app.example.com/next" },
      },
      { time: 9_000, category: "ui.click", level: "info", message: "button#save" },
    ]);
  });

  test("redacts URLs with secretKeys by default", () => {
    const fake = fakeTargets();
    setUp(undefined, fake.targets);

    const [crumb] = trailOf(() => fake.history.pushState(null, "", "https://app.example.com/?token=abc"));

    expect(crumb?.data).toEqual({ from: "https://app.example.com/", to: "https://app.example.com/?token=[REDACTED]" });
  });

  test("redacts URLs with the given policy", () => {
    const fake = fakeTargets();
    const redaction: RedactionPolicy = { keys: ["page"] };
    setUp({ redaction }, fake.targets);

    const [crumb] = trailOf(() => fake.history.pushState(null, "", "https://app.example.com/?token=abc&page=2"));

    expect(crumb?.data).toEqual({ from: "https://app.example.com/", to: "https://app.example.com/?token=abc&page=[REDACTED]" });
  });

  test("passes the integration's options to each type's install", () => {
    const time = createManualTime(1);
    const fake = fakeTargets();
    const redaction: RedactionPolicy = { keys: ["x"] };
    setUp({ clock: time.clock, redaction, clicks: { selectorAttributes: ["title"] } }, fake.targets);

    expect(activeOptions("console")).toEqual({ clock: time.clock });
    expect(activeOptions("fetch")).toEqual({ clock: time.clock, redaction });
    expect(activeOptions("xhr")).toEqual({ clock: time.clock, redaction });
    expect(activeOptions("navigation")).toEqual({ clock: time.clock, redaction });
    expect(activeOptions("clicks")).toEqual({ clock: time.clock, selectorAttributes: ["title"] });
  });

  test("defaults the redaction policy, the selector attributes and the clock", () => {
    setUp(undefined, fakeTargets().targets);

    expect(activeOptions<{ redaction: unknown }>("fetch")?.redaction).toBe(secretKeys);
    expect(activeOptions<{ selectorAttributes: unknown }>("clicks")?.selectorAttributes).toEqual([
      "data-testid",
      "name",
      "aria-label",
      "title",
      "role",
    ]);
    expect(activeOptions<{ clock: unknown }>("console")?.clock).toBeTypeOf("function");
  });

  test.each(TYPES)("false turns %s off and leaves its global untouched", (type) => {
    const fake = fakeTargets();
    setUp({ [type]: false } as AutoBreadcrumbsOptions, fake.targets);

    for (const other of TYPES) {
      expect(activeOptions(other) === undefined).toBe(other === type);
    }
  });

  test("every type off installs nothing", () => {
    const fake = fakeTargets();
    setUp({ console: false, fetch: false, xhr: false, navigation: false, clicks: false }, fake.targets);

    expect(fake.state()).toEqual(UNTOUCHED);
  });

  test("true and an options object each turn a type on", () => {
    const fake = fakeTargets();
    setUp({ console: true, fetch: {}, xhr: true, navigation: {}, clicks: {} }, fake.targets);

    expect(fake.state()).toEqual(INSTRUMENTED);
  });

  test("renders clicks with the configured selector attributes, copied when the integration is created", () => {
    const fake = fakeTargets();
    const selectorAttributes = ["title"];
    const integration = createAutoBreadcrumbs({ clicks: { selectorAttributes } }, () => fake.targets);
    selectorAttributes.push("role");
    teardowns.push(integration.setup(host) as () => void);

    const trail = trailOf(() => fake.document.click(element("DIV", { title: "t", role: "r" })));

    expect(trail.map((crumb) => crumb.message)).toEqual(['div[title="t"]']);
    expect(Object.isFrozen(activeOptions<{ selectorAttributes: unknown }>("clicks")?.selectorAttributes)).toBe(true);
  });

  test("teardown restores every original and is idempotent", () => {
    const fake = fakeTargets();
    const teardown = setUp(undefined, fake.targets);

    teardown();
    expect(fake.state()).toEqual(UNTOUCHED);
    for (const type of TYPES) {
      expect(activeOptions(type)).toBeUndefined();
    }
    teardown();
    expect(fake.state()).toEqual(UNTOUCHED);
  });

  test("teardown leaves only what its own setup installed", () => {
    const fake = fakeTargets();
    const all = setUp(undefined, fake.targets);
    const consoleOnly = setUp({ fetch: false, xhr: false, navigation: false, clicks: false }, fake.targets);

    all();
    expect(fake.state()).toEqual({ ...UNTOUCHED, log: false });
    consoleOnly();
    expect(fake.state()).toEqual(UNTOUCHED);
  });

  test("reads the targets at each setup", () => {
    const first = fakeTargets();
    const second = fakeTargets();
    let current = first.targets;
    const integration = createAutoBreadcrumbs(undefined, () => current);

    const teardownFirst = integration.setup(host) as () => void;
    teardownFirst();
    current = second.targets;
    teardowns.push(integration.setup(host) as () => void);

    expect(first.state()).toEqual(UNTOUCHED);
    expect(second.state()).toEqual(INSTRUMENTED);
  });

  test.each([
    ["first", [0, 1]],
    ["second", [1, 0]],
  ] as const)("two reporters keep one wrapper while either lives, closing the %s first", async (_label, order) => {
    const fake = fakeTargets();
    const reporters = [0, 1].map(() => createReporter((b) => b.add(createAutoBreadcrumbs(undefined, () => fake.targets))));
    const wrapped = fake.consoleTarget.log;

    expect(fake.state()).toEqual(INSTRUMENTED);
    expect(trailOf(() => fake.consoleTarget.log("once"))).toHaveLength(1);

    await reporters[order[0]]?.close();
    expect(fake.consoleTarget.log).toBe(wrapped);
    expect(fake.state()).toEqual(INSTRUMENTED);
    expect(trailOf(() => fake.consoleTarget.log("still once"))).toHaveLength(1);

    await reporters[order[1]]?.close();
    expect(fake.state()).toEqual(UNTOUCHED);
    expect(trailOf(() => fake.consoleTarget.log("none"))).toEqual([]);
  });

  describe("validates its options when created", () => {
    test.each<[string, unknown]>([
      ["null options", null],
      ["array options", []],
      ["number options", 1],
      ["a number toggle", { console: 1 }],
      ["a string toggle", { fetch: "yes" }],
      ["a null toggle", { xhr: null }],
      ["an array toggle", { navigation: [] }],
      ["a function toggle", { clicks: () => true }],
      ["non-array selectorAttributes", { clicks: { selectorAttributes: "title" } }],
      ["a non-string selector attribute", { clicks: { selectorAttributes: ["title", 1] } }],
      ["a null redaction", { redaction: null }],
      ["a string redaction", { redaction: "secretKeys" }],
      ["an array redaction", { redaction: [] }],
      ["a redaction without keys", { redaction: {} }],
      ["a redaction with non-array keys", { redaction: { keys: "token" } }],
      ["a redaction with non-array except", { redaction: { keys: [], except: "x" } }],
      ["a redaction with non-array detectors", { redaction: { keys: [], detectors: {} } }],
      ["a non-function clock", { clock: 1 }],
    ])("throws ReporterConfigError for %s", (_label, options) => {
      const error = configError(() => autoBreadcrumbs(options as AutoBreadcrumbsOptions));

      expect(isReporterConfigError(error)).toBe(true);
      expect((error as Error).message).toMatch(/^Invalid autoBreadcrumbs /);
    });

    test("names the offending option and its type", () => {
      expect((configError(() => autoBreadcrumbs({ console: 1 } as never)) as Error).message).toBe(
        "Invalid autoBreadcrumbs console of type number: expected a boolean or an options object.",
      );
      expect((configError(() => autoBreadcrumbs([] as never)) as Error).message).toBe(
        "Invalid autoBreadcrumbs options of type array: expected an object.",
      );
      expect((configError(() => autoBreadcrumbs({ redaction: null } as never)) as Error).message).toBe(
        "Invalid autoBreadcrumbs redaction of type null: expected a RedactionPolicy.",
      );
    });

    test("accepts a full policy with except and detectors", () => {
      expect(() => autoBreadcrumbs({ redaction: { keys: [], except: [], detectors: [] } })).not.toThrow();
    });
  });
});
