import { expect, test } from "vitest";
import { createAsyncContextStore } from "../context";
import { createChildScope, getScopeTree, type Scope } from "./root";
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

test("every handle reads and writes one shared context, even a second, independently constructed one", () => {
  // getScopeStore() memoizes its own handle, so a second call proves nothing about sharing across
  // handles; a handle built directly with the same key, as a second copy of the package would, does.
  const independentHandle = createAsyncContextStore<Scope>("scope", getScopeTree().defaultScope);
  const child = createChildScope(getScopeTree().defaultScope, "request", {});

  expect(getScopeStore().propagate(child, () => independentHandle.current())).toBe(child);
});
