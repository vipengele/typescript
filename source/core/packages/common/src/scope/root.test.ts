import { afterEach, describe, expect, test } from "vitest";
import { VipengeleError } from "../errors/vipengele-error";
import {
  createChildScope,
  createScopeTree,
  getScopeTree,
  isReservedScopeKeyError,
  type Resource,
  ReservedScopeKeyError,
  type Scope,
  type ScopeTree,
} from "./root";

const RESOURCE: Resource = {
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "process.runtime.name": "nodejs",
};

const RESERVED_KEYS = Object.keys(RESOURCE);

function reservedKeyErrorOf(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected fn to throw");
}

describe("the root", () => {
  test("holds the resource's four keys", () => {
    const { root } = createScopeTree(RESOURCE);

    for (const key of RESERVED_KEYS) {
      expect(root.get(key)).toBe(RESOURCE[key as keyof Resource]);
    }
  });

  test("carries no tag", () => {
    expect(createScopeTree(RESOURCE).root.tag).toBeUndefined();
  });

  test.for(["service.name", "user.id"])("refuses set(%s), reserved or not", (key) => {
    const { root } = createScopeTree(RESOURCE);

    expect(isReservedScopeKeyError(reservedKeyErrorOf(() => root.set(key, "x")))).toBe(true);
    expect(root.get(key)).toBe(RESOURCE[key as keyof Resource]);
  });

  test("keeps a key reserved when the resource leaves its value undefined", () => {
    const { root, defaultScope } = createScopeTree({ ...RESOURCE, "service.version": undefined });

    expect(root.get("service.version")).toBeUndefined();
    expect(() => defaultScope.set("service.version", "9.9.9")).toThrow(ReservedScopeKeyError);
  });

  test("never reads a key the resource does not define", () => {
    const { root } = createScopeTree(RESOURCE);

    expect(root.get("user.id")).toBeUndefined();
    expect(root.get("toString")).toBeUndefined();
  });
});

describe("the default scope", () => {
  test("carries no tag and reads the root's keys through its ancestry", () => {
    const { defaultScope } = createScopeTree(RESOURCE);

    expect(defaultScope.tag).toBeUndefined();
    expect(defaultScope.get("service.name")).toBe("checkout");
  });

  test("is mutable", () => {
    const { defaultScope } = createScopeTree(RESOURCE);

    defaultScope.set("user.id", "u-1");

    expect(defaultScope.get("user.id")).toBe("u-1");
  });

  test.for(RESERVED_KEYS)("refuses set(%s), since the root holds it", (key) => {
    const { defaultScope } = createScopeTree(RESOURCE);

    expect(() => defaultScope.set(key, "shadow")).toThrow(ReservedScopeKeyError);
    expect(defaultScope.get(key)).toBe(RESOURCE[key as keyof Resource]);
  });
});

describe(createChildScope.name, () => {
  test("carries its tag and its own attributes", () => {
    const { defaultScope } = createScopeTree(RESOURCE);

    const child = createChildScope(defaultScope, "GET /orders", { "http.route": "/orders" });

    expect(child.tag).toBe("GET /orders");
    expect(child.get("http.route")).toBe("/orders");
  });

  test("reads an ancestor's value set after the child was created", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const request = createChildScope(defaultScope, "request", {});
    const step = createChildScope(request, "step", {});

    request.set("user.id", "u-1");

    expect(step.get("user.id")).toBe("u-1");
    expect(step.get("service.name")).toBe("checkout");
  });

  test("the innermost value wins, and a child's set never reaches its ancestors", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const request = createChildScope(defaultScope, "request", { "user.id": "outer" });
    const step = createChildScope(request, "step", {});

    step.set("user.id", "inner");

    expect(step.get("user.id")).toBe("inner");
    expect(request.get("user.id")).toBe("outer");
  });

  test("a value set to undefined still shadows the ancestor's", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const request = createChildScope(defaultScope, "request", { "user.id": "u-1" });

    const step = createChildScope(request, "step", { "user.id": undefined });

    expect(step.get("user.id")).toBeUndefined();
  });

  test("copies its attributes, so later changes to the passed record do not reach it", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const attributes: Record<string, unknown> = { "user.id": "u-1" };

    const child = createChildScope(defaultScope, "request", attributes);
    attributes["user.id"] = "u-2";

    expect(child.get("user.id")).toBe("u-1");
  });

  test("stores a __proto__ key as an attribute", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "request", {});

    child.set("__proto__", "value");

    expect(child.get("__proto__")).toBe("value");
    expect(child.get("toString")).toBeUndefined();
  });

  test.for(RESERVED_KEYS)("refuses an initial attribute %s the root holds", (key) => {
    const { defaultScope } = createScopeTree(RESOURCE);

    expect(() => createChildScope(defaultScope, "request", { [key]: "shadow" })).toThrow(ReservedScopeKeyError);
  });

  test("refuses a root-held key at any depth", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const deep = createChildScope(createChildScope(defaultScope, "a", {}), "b", {});

    expect(() => deep.set("process.runtime.name", "deno")).toThrow(ReservedScopeKeyError);
  });

  test("exposes tag, get and set, and no ancestry", () => {
    const { defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "request", {});

    expect(Object.keys(child)).toEqual(["tag"]);
    expect("parent" in child).toBe(false);
  });

  test("walks and guards a tree whose ancestors another copy of the package built", () => {
    const foreignRoot = {
      tag: undefined,
      get: () => undefined,
      set: () => undefined,
      [Symbol.for("vipengele:scope:parent")]: undefined,
      [Symbol.for("vipengele:scope:attributes")]: Object.freeze({ "service.name": "foreign" }),
    };
    const foreignDefault = {
      tag: undefined,
      get: () => undefined,
      set: () => undefined,
      [Symbol.for("vipengele:scope:parent")]: foreignRoot,
      [Symbol.for("vipengele:scope:attributes")]: { "user.id": "u-1" },
    };

    const child = createChildScope(foreignDefault as Scope, "request", {});

    expect(child.get("service.name")).toBe("foreign");
    expect(child.get("user.id")).toBe("u-1");
    expect(() => child.set("service.name", "shadow")).toThrow(ReservedScopeKeyError);
  });
});

describe(ReservedScopeKeyError.name, () => {
  /** Stands in for a second resolved copy of this package: same code, unrelated class identity. */
  class ForeignCopy extends Error {
    readonly code = "common.scope.reserved-key";
  }

  class OtherError extends VipengeleError {
    readonly code = "common.scope.other";
  }

  test("extends Error and VipengeleError, with a namespaced code", () => {
    const error = new ReservedScopeKeyError("nope");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VipengeleError);
    expect(error.code).toBe("common.scope.reserved-key");
  });

  test("the guard accepts an error of the same code from another class identity", () => {
    expect(isReservedScopeKeyError(new ForeignCopy("nope"))).toBe(true);
  });

  test.for([new OtherError("nope"), new Error("nope"), null, "common.scope.reserved-key", { code: "common.scope.reserved-key" }])(
    "the guard rejects %o",
    (value) => {
      expect(isReservedScopeKeyError(value)).toBe(false);
    },
  );
});

describe(getScopeTree.name, () => {
  const slot = Symbol.for("vipengele:scope:tree");
  const registry = globalThis as unknown as Record<symbol, unknown>;
  const original = registry[slot];

  afterEach(() => {
    registry[slot] = original;
  });

  test("returns the same tree on every call", () => {
    expect(getScopeTree()).toBe(getScopeTree());
  });

  test("the default scope is a child of the root", () => {
    const { root, defaultScope } = getScopeTree();

    expect(root).not.toBe(defaultScope);
    expect(() => defaultScope.set("service.name", "x")).toThrow(ReservedScopeKeyError);
  });

  test("builds, when nothing supplied a resource, a root whose four keys are reserved and undefined", () => {
    registry[slot] = undefined;

    const { root, defaultScope } = getScopeTree();

    for (const key of RESERVED_KEYS) {
      expect(root.get(key)).toBeUndefined();
      expect(() => defaultScope.set(key, "x")).toThrow(ReservedScopeKeyError);
    }
  });

  test("returns a tree another copy of the package already placed in the slot", () => {
    const foreign: ScopeTree = createScopeTree(RESOURCE);
    registry[slot] = foreign;

    expect(getScopeTree()).toBe(foreign);
  });
});
