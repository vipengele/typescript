import { expect, test } from "vitest";
import { createChildScope, getScopeTree } from "./root";
import { getScopeStore } from "./store";

test("the current scope outside any propagation is the realm's default scope", () => {
  expect(getScopeStore().current()).toBe(getScopeTree().defaultScope);
});

test("a propagated scope is current for fn, and the default scope is back once fn returns", () => {
  const store = getScopeStore();
  const child = createChildScope(getScopeTree().defaultScope, "request", {});

  expect(store.propagate(child, () => store.current())).toBe(child);
  expect(store.current()).toBe(getScopeTree().defaultScope);
});

test("every handle reads and writes one shared context", () => {
  const child = createChildScope(getScopeTree().defaultScope, "request", {});

  expect(getScopeStore().propagate(child, () => getScopeStore().current())).toBe(child);
});
