import { normalizeAttributes } from "@vipengele/ts-core-common";
import { describe, expect, it } from "vitest";
import { mergeAttributes } from "./merge-attributes";

/** A layer of 150 keys, normalized so the breadth bound cuts it and writes its marker under `"…"`. */
function wideLayer(prefix: string) {
  return normalizeAttributes(Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`${prefix}${index}`, index])));
}

describe("mergeAttributes", () => {
  it("returns an empty record for no layers", () => {
    expect(mergeAttributes([])).toEqual({});
  });

  it("lets a later layer win a shared key over every earlier one", () => {
    expect(
      mergeAttributes([
        { shared: "low", low: 1 },
        { shared: "mid", mid: 2 },
        { shared: "high", high: 3 },
      ]),
    ).toEqual({
      shared: "high",
      low: 1,
      mid: 2,
      high: 3,
    });
  });

  it("keeps a key in the position its lowest layer gave it", () => {
    expect(
      Object.keys(
        mergeAttributes([
          { a: 1, b: 2 },
          { c: 3, a: 4 },
        ]),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("moves every shadowed truncation marker of a cut layer to its own free key", () => {
    const merged = mergeAttributes([wideLayer("low"), wideLayer("mid"), wideLayer("high")]);

    expect(merged["…"]).toBe("[Truncated: 50 more]");
    expect(merged["…#1"]).toBe("[Truncated: 50 more]");
    expect(merged["…#2"]).toBe("[Truncated: 50 more]");
    expect(merged.low0).toBe(0);
    expect(merged.mid0).toBe(0);
    expect(merged.high0).toBe(0);
  });

  it("skips a suffix any layer already holds when it moves a marker", () => {
    const merged = mergeAttributes([wideLayer("low"), { "…#1": "taken", ...wideLayer("high") }]);

    expect(merged["…"]).toBe("[Truncated: 50 more]");
    expect(merged["…#1"]).toBe("taken");
    expect(merged["…#2"]).toBe("[Truncated: 50 more]");
  });

  it("leaves a marker under its own key when no higher layer holds that key", () => {
    const merged = mergeAttributes([{ other: 1 }, wideLayer("mid"), { high: 1 }]);

    expect(merged["…"]).toBe("[Truncated: 50 more]");
    expect(Object.hasOwn(merged, "…#1")).toBe(false);
  });

  it("lets a higher layer overwrite a shadowed value that is not a truncation marker", () => {
    expect(mergeAttributes([{ "…": "plain", count: 1 }, { "…": "high" }])).toEqual({ "…": "high", count: 1 });
  });

  it("keeps a `__proto__` key as an own key instead of replacing the prototype", () => {
    const merged = mergeAttributes([JSON.parse('{"__proto__": "low"}'), { other: 1 }]);

    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});
