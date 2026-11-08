// biome-ignore-all lint/security/noSecrets: every fixture is a CSS selector, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { type ClickInstrumentationOptions, type ClickTarget, installClicks } from "./clicks";
import { DEFAULT_SELECTOR_ATTRIBUTES } from "./selector";

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

type Listener = (event: unknown) => void;

/** A stand-in `document` that keeps its `click` listeners with their capture flag and dispatches to them. */
function fakeDocument() {
  const listeners: { listener: Listener; capture: boolean }[] = [];
  const document = {
    addEventListener(type: string, listener: Listener, capture: boolean) {
      if (type === "click") {
        listeners.push({ listener, capture });
      }
    },
    removeEventListener(type: string, listener: Listener, capture: boolean) {
      const index = listeners.findIndex((entry) => type === "click" && entry.listener === listener && entry.capture === capture);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    },
    click(target: unknown) {
      for (const { listener } of [...listeners]) {
        listener({ target });
      }
    },
  };
  return { document, listeners, target: { document } satisfies ClickTarget };
}

function element(tagName: string, attributes: Record<string, string> = {}, parentElement: unknown = null) {
  return {
    tagName,
    parentElement,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

function installed(options: ClickInstrumentationOptions, target: ClickTarget): () => void {
  const uninstall = installClicks(options, target);
  uninstalls.push(uninstall);
  return uninstall;
}

/** Runs `fn` in a fresh Unit of Work, synchronously, and returns the trail it left. */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

describe("installClicks", () => {
  test("adds one capture-phase click listener and records the clicked element's selector", () => {
    const time = createManualTime(7_000);
    const { document, listeners, target } = fakeDocument();
    installed({ clock: time.clock, selectorAttributes: DEFAULT_SELECTOR_ATTRIBUTES }, target);

    const trail = trailOf(() => document.click(element("BUTTON", { id: "save", "data-testid": "save" }, element("FORM"))));

    expect(listeners.map((entry) => entry.capture)).toEqual([true]);
    expect(trail).toEqual([{ time: 7_000, category: "ui.click", level: "info", message: 'form > button#save[data-testid="save"]' }]);
  });

  test("a second install adds no second listener and records each click once", () => {
    const { document, listeners, target } = fakeDocument();
    installed({ clock: () => 1, selectorAttributes: [] }, target);
    installed({ clock: () => 2, selectorAttributes: [] }, target);

    const trail = trailOf(() => document.click(element("A")));

    expect(listeners).toHaveLength(1);
    expect(trail).toEqual([{ time: 1, category: "ui.click", level: "info", message: "a" }]);
  });

  test("the oldest live install's selector attributes apply, read at each click", () => {
    const { document, target } = fakeDocument();
    const first = installed({ clock: () => 0, selectorAttributes: ["title"] }, target);
    installed({ clock: () => 0, selectorAttributes: ["role"] }, target);
    const button = element("BUTTON", { title: "t", role: "r" });

    const trail = trailOf(() => {
      document.click(button);
      first();
      document.click(button);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual(['button[title="t"]', 'button[role="r"]']);
  });

  test("a click on a text node renders its parent element", () => {
    const { document, target } = fakeDocument();
    installed({ clock: () => 0, selectorAttributes: [] }, target);

    const trail = trailOf(() => document.click({ nodeType: 3, parentElement: element("P", { id: "intro" }) }));

    expect(trail.map((crumb) => crumb.message)).toEqual(["p#intro"]);
  });

  test("a click with no element to render records nothing", () => {
    const { document, target } = fakeDocument();
    installed({ clock: () => 0, selectorAttributes: [] }, target);

    const trail = trailOf(() => {
      document.click({ nodeType: 9 });
      document.click({ nodeType: 3, parentElement: null });
      document.click(undefined);
      document.click("button");
    });

    expect(trail).toEqual([]);
  });

  test("an event with no target or that is not an object records nothing", () => {
    const { listeners, target } = fakeDocument();
    installed({ clock: () => 0, selectorAttributes: [] }, target);
    const [{ listener }] = listeners as [{ listener: Listener; capture: boolean }];

    const trail = trailOf(() => {
      listener(undefined);
      listener(null);
      listener({});
    });

    expect(trail).toEqual([]);
  });

  test("defaults a missing clock and selector attributes from another copy's entry", () => {
    const { document, target } = fakeDocument();
    installed({} as ClickInstrumentationOptions, target);
    const before = Date.now();

    const [crumb] = trailOf(() => document.click(element("DIV", { role: "tab", title: "t" })));

    expect(crumb?.message).toBe('div[title="t"][role="tab"]');
    expect(crumb?.time).toBeGreaterThanOrEqual(before);
  });

  test("a click while suppressed records nothing", () => {
    const { document, target } = fakeDocument();
    installed({ clock: () => 0, selectorAttributes: [] }, target);

    const trail = trailOf(() => suppressBreadcrumbs(() => document.click(element("A"))));

    expect(trail).toEqual([]);
  });

  test("a throwing clock drops the crumb and never reaches the dispatcher", () => {
    const { document, target } = fakeDocument();
    installed(
      {
        clock: () => {
          throw new Error("clock");
        },
        selectorAttributes: [],
      },
      target,
    );

    const trail = trailOf(() => document.click(element("A")));

    expect(trail).toEqual([]);
  });

  test("the last install to leave removes the listener", () => {
    const { listeners, target } = fakeDocument();
    const first = installed({ clock: () => 0, selectorAttributes: [] }, target);
    const second = installed({ clock: () => 0, selectorAttributes: [] }, target);

    first();
    expect(listeners).toHaveLength(1);
    second();
    expect(listeners).toEqual([]);
  });

  test("a listener left attached after teardown records nothing", () => {
    const { document, listeners, target } = fakeDocument();
    const uninstall = installed({ clock: () => 0, selectorAttributes: [] }, target);
    const [{ listener }] = listeners as [{ listener: Listener; capture: boolean }];

    uninstall();
    const trail = trailOf(() => {
      listener({ target: element("A") });
      document.click(element("A"));
    });

    expect(trail).toEqual([]);
  });

  test("installs nothing when the target has no document that takes listeners", () => {
    expect(installClicks({ clock: () => 0, selectorAttributes: [] }, {})).toBeTypeOf("function");
    expect(() => installClicks({ clock: () => 0, selectorAttributes: [] }, { document: { addEventListener() {} } })()).not.toThrow();
    expect(() => installClicks({ clock: () => 0, selectorAttributes: [] }, null as unknown as ClickTarget)()).not.toThrow();
    const throwing = {
      get document(): unknown {
        throw new Error("denied");
      },
    };
    expect(() => installClicks({ clock: () => 0, selectorAttributes: [] }, throwing)()).not.toThrow();
  });

  test("a document whose addEventListener throws joins nothing, and the next install tries again", () => {
    const { document, listeners, target } = fakeDocument();
    const broken = {
      document: {
        addEventListener() {
          throw new Error("denied");
        },
        removeEventListener() {},
      },
    };
    installed({ clock: () => 1, selectorAttributes: [] }, broken);
    installed({ clock: () => 2, selectorAttributes: [] }, target);

    const trail = trailOf(() => document.click(element("A")));

    expect(listeners).toHaveLength(1);
    expect(trail.map((crumb) => crumb.time)).toEqual([2]);
  });
});
