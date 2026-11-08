/** The attributes a click selector renders when the options name none. */
export const DEFAULT_SELECTOR_ATTRIBUTES: readonly string[] = Object.freeze(["data-testid", "name", "aria-label", "title", "role"]);

/** The most elements a selector renders: the clicked element and up to four of its ancestors. */
export const MAX_SELECTOR_DEPTH = 5;

/** The most UTF-16 code units a selector holds. */
export const MAX_SELECTOR_LENGTH = 200;

/**
 * The attribute a selector never renders, whatever the options list: it holds what a user typed
 * into a form control.
 */
const REFUSED_ATTRIBUTE = "value";

/** The parts of a DOM `Element` a selector reads. Nothing else on the element is touched. */
export interface SelectorElement {
  readonly tagName?: unknown;
  readonly parentElement?: unknown;
  getAttribute?(name: string): unknown;
}

function isElement(value: unknown): value is SelectorElement {
  return typeof value === "object" && value !== null && typeof (value as SelectorElement).tagName === "string";
}

/** The attribute's text, or `undefined` when the element has none or reading it throws. */
function attribute(element: SelectorElement, name: string): string | undefined {
  try {
    const value = element.getAttribute?.(name);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** `[name="value"]`, with backslashes and double quotes in `value` escaped. */
function attributeSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/[\\"]/g, (character) => `\\${character}`)}"]`;
}

/**
 * One element as `tag#id.class[attr="v"]`, the tag lower-cased. An `<input>` renders as its tag and
 * its `type` attribute alone, so nothing it carries about what was typed reaches the selector.
 * Attributes are read with `getAttribute`; the element's text and an input's value are never read.
 */
function segment(element: SelectorElement, tagName: string, attributes: readonly unknown[]): string {
  const tag = tagName.toLowerCase();
  if (tag === "input") {
    const type = attribute(element, "type");
    return type === undefined ? tag : `${tag}${attributeSelector("type", type)}`;
  }
  let rendered = tag;
  const id = attribute(element, "id");
  if (id !== undefined && id !== "") {
    rendered += `#${id}`;
  }
  for (const name of (attribute(element, "class") ?? "").split(/\s+/)) {
    if (name !== "") {
      rendered += `.${name}`;
    }
  }
  for (const name of attributes) {
    if (typeof name !== "string" || name.toLowerCase() === REFUSED_ATTRIBUTE) {
      continue;
    }
    const value = attribute(element, name);
    if (value !== undefined) {
      rendered += attributeSelector(name, value);
    }
  }
  return rendered;
}

/**
 * `element` and up to {@link MAX_SELECTOR_DEPTH} − 1 of its ancestors as a selector, innermost
 * last, each rendered as `tag#id.class[attr="v"]` and joined by ` > `. `attributes` names the
 * attributes rendered, in order; `value` is refused even when listed. The result holds at most
 * {@link MAX_SELECTOR_LENGTH} code units: ancestors are left out from the outermost in until it
 * fits, and the clicked element's own segment is cut when it alone is too long. Gives `""` when
 * `element` is not an element, and never throws: an ancestor that cannot be read ends the walk.
 */
export function renderSelector(element: unknown, attributes: readonly unknown[] = DEFAULT_SELECTOR_ATTRIBUTES): string {
  let selector = "";
  let current: unknown = element;
  try {
    for (let depth = 0; depth < MAX_SELECTOR_DEPTH && isElement(current); depth += 1) {
      const rendered = segment(current, current.tagName as string, attributes);
      if (selector === "") {
        selector = rendered.slice(0, MAX_SELECTOR_LENGTH);
      } else {
        const longer = `${rendered} > ${selector}`;
        if (longer.length > MAX_SELECTOR_LENGTH) {
          break;
        }
        selector = longer;
      }
      current = current.parentElement;
    }
  } catch {
    // The selector keeps the elements rendered before the one that could not be read.
  }
  return selector;
}
