// biome-ignore-all lint/security/noSecrets: every fixture is a CSS selector, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test } from "vitest";
import { installClicks } from "./clicks";
import { DEFAULT_SELECTOR_ATTRIBUTES } from "./selector";

// Browser-only: the page's real `document`, with clicks dispatched on real elements. The suite in
// both runtimes covers the logic against a stand-in document.

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

function install(): void {
  cleanups.push(installClicks({ clock: () => 0, selectorAttributes: DEFAULT_SELECTOR_ATTRIBUTES }));
}

/**
 * Parses `html` into a fresh container appended to the body, removed again after the test. A
 * fixture's buttons are `type="button"`: a submit would navigate the test page away.
 */
function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.id = "fixture";
  container.innerHTML = html;
  document.body.append(container);
  cleanups.push(() => container.remove());
  return container;
}

/**
 * Runs `fn` in a fresh Unit of Work and returns the trail it left. Dispatching an event runs its
 * listeners synchronously, so they record into the Unit of Work current around `dispatchEvent`.
 */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

function click(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("installClicks on the real document", () => {
  test("records the clicked element's selector with its ancestors", () => {
    install();
    const container = mount(
      '<form id="checkout" class="card wide"><button type="button" data-testid="pay" title="Pay now">Pay 10 EUR</button></form>',
    );

    const trail = trailOf(() => click(container.querySelector("button") as HTMLButtonElement));

    expect(trail).toEqual([
      {
        time: 0,
        category: "ui.click",
        level: "info",
        message: 'html > body > div#fixture > form#checkout.card.wide > button[data-testid="pay"][title="Pay now"]',
      },
    ]);
  });

  test("records an input's tag and type alone, never what was typed", () => {
    install();
    const container = mount('<label>Card <input id="card" class="secret" type="password" name="card" value="4111111111111111" /></label>');
    const input = container.querySelector("input") as HTMLInputElement;
    input.value = "typed-secret";

    const trail = trailOf(() => click(input));

    expect(trail.map((crumb) => crumb.message)).toEqual(['html > body > div#fixture > label > input[type="password"]']);
    expect(JSON.stringify(trail)).not.toMatch(/4111|typed-secret|Card/);
  });

  test("records in the capture phase, before a handler that stops propagation", () => {
    install();
    const container = mount('<a role="link">go</a>');
    const link = container.querySelector("a") as HTMLAnchorElement;
    link.addEventListener("click", (event) => event.stopPropagation());

    const trail = trailOf(() => link.click());

    expect(trail.map((crumb) => crumb.message)).toEqual(['html > body > div#fixture > a[role="link"]']);
  });

  test("a click dispatched on a text node renders its parent element", () => {
    install();
    const container = mount("<p id=intro>Hello</p>");
    const text = (container.querySelector("p") as HTMLParagraphElement).firstChild as Text;

    const trail = trailOf(() => click(text));

    expect(trail.map((crumb) => crumb.message)).toEqual(["html > body > div#fixture > p#intro"]);
  });

  test("a click dispatched on the document itself records nothing", () => {
    install();

    expect(trailOf(() => click(document))).toEqual([]);
  });

  test("records nothing once the last install has left", () => {
    const uninstall = installClicks({ clock: () => 0, selectorAttributes: [] });
    const container = mount('<button type="button">b</button>');

    uninstall();

    expect(trailOf(() => click(container.querySelector("button") as HTMLButtonElement))).toEqual([]);
  });
});
