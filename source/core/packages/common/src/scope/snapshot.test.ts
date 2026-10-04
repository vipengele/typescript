import { afterEach, describe, expect, test, vi } from "vitest";
import { type Resource, type Scope, createChildScope, createScopeTree, snapshot } from "./root";
import { Scope as ScopeApi } from "./scope";

const PARENT = Symbol.for("vipengele:scope:parent");
const ATTRIBUTES = Symbol.for("vipengele:scope:attributes");

const RESOURCE: Resource = {
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "process.runtime.name": "nodejs",
};

/** A scope node built by hand from the `Symbol.for` slots, as another copy of the package would build one. */
function node(parent: unknown, attributes: unknown): Scope {
  return {
    tag: undefined,
    get: () => undefined,
    set: () => undefined,
    [PARENT]: parent,
    [ATTRIBUTES]: attributes,
  } as Scope;
}

describe(snapshot.name, () => {
  test("is an empty record for the default scope with nothing set", () => {
    expect(snapshot(ScopeApi.current())).toEqual({});
  });

  test("returns a prototype-less record", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "request", { "user.id": "u-1" });

    expect(Object.getPrototypeOf(snapshot(child))).toBeNull();
    expect(Object.getPrototypeOf(snapshot(defaultScope))).toBeNull();
  });

  test("flattens a scope and its ancestors, the innermost value winning", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    defaultScope.set("tenant", "t-1");
    const request = createChildScope(defaultScope, "request", { "user.id": "outer", route: "/orders" });
    const step = createChildScope(request, "step", { "user.id": "inner" });

    expect(snapshot(step)).toEqual({ tenant: "t-1", "user.id": "inner", route: "/orders" });
    expect(snapshot(request)).toEqual({ tenant: "t-1", "user.id": "outer", route: "/orders" });
  });

  test("shadows an outer value with inherit and restores it afterwards", () => {
    ScopeApi.isolated("request", { "user.id": "outer" }, () => {
      ScopeApi.inherit("step", { "user.id": "inner" }, () => {
        expect(snapshot(ScopeApi.current())["user.id"]).toBe("inner");
      });
      expect(snapshot(ScopeApi.current())["user.id"]).toBe("outer");
    });
  });

  test("includes the attributes of an isolated scope", () => {
    ScopeApi.isolated("request", { "user.id": "u-1" }, () => {
      expect(snapshot(ScopeApi.current())).toEqual({ "user.id": "u-1" });
    });
  });

  test("leaves out the root's four Resource keys", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "request", { "user.id": "u-1" });

    const result = snapshot(child);

    expect(result).toEqual({ "user.id": "u-1" });
    for (const key of Object.keys(RESOURCE)) {
      expect(Object.hasOwn(result, key)).toBe(false);
    }
  });

  test("leaves out a root-held key that a non-root node holds", () => {
    const root = node(undefined, Object.freeze({ "service.name": "foreign" }));
    const child = node(root, { "service.name": "shadow", "user.id": "u-1" });

    expect(snapshot(child)).toEqual({ "user.id": "u-1" });
  });

  test("keeps a key set to undefined as an own key shadowing the parent's value", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const request = createChildScope(defaultScope, "request", { "user.id": "u-1" });
    const step = createChildScope(request, "step", { "user.id": undefined });

    const result = snapshot(step);

    expect(Object.hasOwn(result, "user.id")).toBe(true);
    expect(result["user.id"]).toBeUndefined();
  });

  test("stores a __proto__ attribute as an own key", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "request", {});
    child.set("__proto__", "value");

    const result = snapshot(child);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.toString).toBeUndefined();
  });

  test.for([undefined, null, 42, "scope", {}, () => undefined])(
    "yields an empty prototype-less record for %o, which is not a scope node",
    (value) => {
      const result = snapshot(value as unknown as Scope);

      expect(result).toEqual({});
      expect(Object.getPrototypeOf(result)).toBeNull();
    },
  );

  test.for([undefined, null, "attributes", 7])("ends the walk at a node whose attributes slot holds %o", (slot) => {
    const good = node(undefined, { "user.id": "u-1" });
    const bad = node(good, slot);
    const child = node(bad, { route: "/orders" });

    expect(snapshot(child)).toEqual({ route: "/orders" });
  });

  test("returns the nodes read before a slot that throws", () => {
    const throwing = {
      tag: undefined,
      get: () => undefined,
      set: () => undefined,
      [PARENT]: undefined,
      get [ATTRIBUTES](): never {
        throw new Error("unreadable");
      },
    } as unknown as Scope;
    const child = node(throwing, { "user.id": "u-1" });

    expect(snapshot(child)).toEqual({ "user.id": "u-1" });
  });

  test("returns the keys copied before an attribute that throws", () => {
    const attributes = { first: 1 };
    Object.defineProperty(attributes, "second", {
      enumerable: true,
      get() {
        throw new Error("unreadable");
      },
    });
    const root = node(undefined, {});
    const child = node(root, attributes);

    const result = snapshot(child);

    expect(result).toEqual({ first: 1 });
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  describe("across two copies of the package", () => {
    const slot = Symbol.for("vipengele:scope:tree");
    const registry = globalThis as unknown as Record<symbol, unknown>;
    const original = registry[slot];

    afterEach(() => {
      registry[slot] = original;
      vi.resetModules();
    });

    test("flattens a scope another copy created", async () => {
      const other = await import("./root");
      vi.resetModules();
      const mine = await import("./root");

      const { defaultScope } = other.getScopeTree();
      const request = other.createChildScope(defaultScope, "request", { "user.id": "u-1" });
      const step = other.createChildScope(request, "step", { route: "/orders" });

      expect(mine.snapshot(step)).toEqual({ "user.id": "u-1", route: "/orders" });
    });
  });
});
