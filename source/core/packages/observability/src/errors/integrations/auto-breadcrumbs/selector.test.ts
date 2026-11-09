// biome-ignore-all lint/security/noSecrets: every fixture is a CSS selector, flagged only for its entropy
import { describe, expect, test } from "vitest";
import { DEFAULT_SELECTOR_ATTRIBUTES, MAX_SELECTOR_LENGTH, renderSelector, type SelectorElement } from "./selector";

interface FakeElement extends SelectorElement {
  readonly reads: string[];
}

/** A stand-in element holding `attributes`, recording each attribute it is asked for. */
function element(tagName: string, attributes: Record<string, string> = {}, parentElement: unknown = null): FakeElement {
  const reads: string[] = [];
  return {
    tagName,
    parentElement,
    reads,
    getAttribute(name: string) {
      reads.push(name);
      return Object.hasOwn(attributes, name) ? (attributes[name] as string) : null;
    },
  };
}

/** A chain of `count` nested `<div class="level-N">`, the innermost returned. */
function chain(count: number): FakeElement {
  let current: FakeElement | null = null;
  for (let level = 1; level <= count; level += 1) {
    current = element("DIV", { class: `level-${level}` }, current);
  }
  return current as FakeElement;
}

describe("renderSelector", () => {
  test("renders the tag lower-cased, the id, every class and the default attributes in order", () => {
    const button = element("BUTTON", {
      id: "save",
      class: " primary  large ",
      role: "button",
      "data-testid": "save-button",
      title: "Save",
      "aria-label": "Save draft",
      name: "save",
    });

    expect(renderSelector(button)).toBe(
      'button#save.primary.large[data-testid="save-button"][name="save"][aria-label="Save draft"][title="Save"][role="button"]',
    );
  });

  test("renders ancestors outermost first, joined by ' > '", () => {
    const form = element("FORM", { id: "checkout" }, element("BODY"));
    const button = element("BUTTON", { class: "pay" }, form);

    expect(renderSelector(button)).toBe("body > form#checkout > button.pay");
  });

  test("renders at most five elements, the clicked one last", () => {
    expect(renderSelector(chain(7))).toBe("div.level-3 > div.level-4 > div.level-5 > div.level-6 > div.level-7");
  });

  test("renders only the listed attributes, in the listed order", () => {
    const link = element("A", { href: "/home", title: "Home", "data-track": "nav" });

    expect(renderSelector(link, ["data-track", "href", "missing"])).toBe('a[data-track="nav"][href="/home"]');
  });

  test("refuses value however it is listed, and never asks for it", () => {
    const option = element("OPTION", { value: "secret", title: "t" });

    expect(renderSelector(option, ["value", "VALUE", "title"])).toBe('option[title="t"]');
    expect(option.reads).not.toContain("value");
    expect(option.reads).not.toContain("VALUE");
  });

  test("skips a listed attribute name that is not a string", () => {
    expect(renderSelector(element("SPAN", { title: "t" }), [42, null, "title"])).toBe('span[title="t"]');
  });

  test("renders an input as its tag and type alone", () => {
    const input = element("INPUT", { id: "card", class: "field", type: "password", name: "card", value: "4111", title: "Card" });

    expect(renderSelector(input, [...DEFAULT_SELECTOR_ATTRIBUTES, "value"])).toBe('input[type="password"]');
    expect(input.reads).toEqual(["type"]);
  });

  test("renders an input with no type as its tag", () => {
    expect(renderSelector(element("INPUT", { id: "q" }))).toBe("input");
  });

  test("escapes backslashes and double quotes in attribute values", () => {
    expect(renderSelector(element("DIV", { title: 'say "hi" \\o/' }))).toBe('div[title="say \\"hi\\" \\\\o/"]');
  });

  test("omits an empty id", () => {
    expect(renderSelector(element("P", { id: "" }))).toBe("p");
  });

  test("leaves out ancestors from the outermost in to stay within the cap", () => {
    const long = "x".repeat(100);
    const outer = element("SECTION", { id: long });
    const middle = element("ARTICLE", { id: long }, outer);
    const inner = element("BUTTON", { id: "go" }, middle);

    const selector = renderSelector(inner);

    expect(selector).toBe(`article#${long} > button#go`);
    expect(selector.length).toBeLessThanOrEqual(MAX_SELECTOR_LENGTH);
  });

  test("cuts the clicked element's own segment at the cap", () => {
    const selector = renderSelector(element("DIV", { title: "y".repeat(500) }, element("BODY")));

    expect(selector).toHaveLength(MAX_SELECTOR_LENGTH);
    expect(selector.startsWith('div[title="yyy')).toBe(true);
  });

  test("gives an empty selector for anything that is not an element", () => {
    expect(renderSelector(undefined)).toBe("");
    expect(renderSelector(null)).toBe("");
    expect(renderSelector("button")).toBe("");
    expect(renderSelector({ nodeType: 9 })).toBe("");
  });

  test("stops at an ancestor that is not an element", () => {
    expect(renderSelector(element("HTML", {}, { nodeType: 9 }))).toBe("html");
  });

  test("an attribute read that throws leaves that attribute out", () => {
    const button: SelectorElement = {
      tagName: "BUTTON",
      getAttribute(name: string) {
        if (name === "id") {
          throw new Error("unreadable");
        }
        return name === "title" ? "ok" : null;
      },
    };

    expect(renderSelector(button)).toBe('button[title="ok"]');
  });

  test("an element without getAttribute renders as its tag", () => {
    expect(renderSelector({ tagName: "SVG" })).toBe("svg");
  });

  test("an ancestor that throws when read ends the walk with what was rendered", () => {
    const inner = {
      tagName: "SPAN",
      get parentElement(): unknown {
        throw new Error("detached");
      },
    };

    expect(renderSelector(inner)).toBe("span");
  });
});
