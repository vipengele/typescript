import { afterEach, describe, expect, test, vi } from "vitest";
import { createChildScope, createScopeTree, getScopeTree, type Resource, ReservedScopeKeyError, type Scope, setResource } from "./root";
import { Scope as ScopeApi } from "./scope";

const ATTRIBUTES = Symbol.for("vipengele:scope:attributes");
const TREE = Symbol.for("vipengele:scope:tree");

const RESOURCE: Resource = {
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "process.runtime.name": "nodejs",
};

type Slotted = Record<symbol, unknown>;

// Every test that mutates the realm's root puts its original attribute bag back, so the Resource a
// test sets never reaches the next one.
const registry = globalThis as unknown as Slotted;
const originalTree = registry[TREE];
const realmRoot = getScopeTree().root as unknown as Slotted;
const originalAttributes = realmRoot[ATTRIBUTES];

afterEach(() => {
  registry[TREE] = originalTree;
  realmRoot[ATTRIBUTES] = originalAttributes;
  vi.resetModules();
});

describe(setResource.name, () => {
  test("replaces every key the argument holds as a string", () => {
    const { root } = createScopeTree(RESOURCE);

    setResource(root, { "service.name": "billing", "process.runtime.name": "browser" });

    expect(root.get("service.name")).toBe("billing");
    expect(root.get("service.version")).toBe("1.2.3");
    expect(root.get("deployment.environment.name")).toBe("production");
    expect(root.get("process.runtime.name")).toBe("browser");
  });

  test("keeps the root's bag frozen and its keys reserved", () => {
    const { root, defaultScope } = createScopeTree(RESOURCE);

    setResource(root, { "service.name": "billing" });

    expect(Object.isFrozen((root as unknown as Slotted)[ATTRIBUTES])).toBe(true);
    expect(() => root.set("service.name", "x")).toThrow(ReservedScopeKeyError);
    expect(() => defaultScope.set("service.name", "x")).toThrow(ReservedScopeKeyError);
  });

  test("never throws, and leaves the Resource as it was, when the argument fails to read", () => {
    const { root } = createScopeTree(RESOURCE);

    expect(() => setResource(root, null as unknown as Partial<Resource>)).not.toThrow();
    expect(root.get("service.name")).toBe("checkout");
  });

  test("never throws when the root refuses the write", () => {
    const { root } = createScopeTree(RESOURCE);
    Object.freeze(root);

    expect(() => setResource(root, { "service.name": "billing" })).not.toThrow();
    expect(root.get("service.name")).toBe("checkout");
  });
});

describe("Scope.setResource", () => {
  test("is read back by Scope.resource", () => {
    ScopeApi.setResource(RESOURCE);

    expect(ScopeApi.resource()).toEqual(RESOURCE);
  });

  test("merges a partial Resource over the values already held", () => {
    ScopeApi.setResource(RESOURCE);

    ScopeApi.setResource({ "service.version": "2.0.0" });

    expect(ScopeApi.resource()).toEqual({ ...RESOURCE, "service.version": "2.0.0" });
  });

  test("skips a key whose value is undefined or not a string, neither clearing nor coercing it", () => {
    ScopeApi.setResource(RESOURCE);

    ScopeApi.setResource({
      "service.name": undefined,
      "service.version": 2 as unknown as string,
      "deployment.environment.name": null as unknown as string,
      "process.runtime.name": { toString: () => "deno" } as unknown as string,
    });

    expect(ScopeApi.resource()).toEqual(RESOURCE);
  });

  test("ignores a key outside the four", () => {
    ScopeApi.setResource({ "service.name": "checkout", "user.id": "u-1" } as Partial<Resource>);

    expect(ScopeApi.resource()["service.name"]).toBe("checkout");
    expect(getScopeTree().root.get("user.id")).toBeUndefined();
    expect(() => createChildScope(getScopeTree().defaultScope, "request", { "user.id": "u-2" })).not.toThrow();
  });

  test("leaves the realm's tree and root in place", () => {
    const tree = getScopeTree();

    ScopeApi.setResource(RESOURCE);

    expect(getScopeTree()).toBe(tree);
    expect(getScopeTree().root).toBe(tree.root);
  });

  test("is seen by an isolated scope already in flight", () => {
    ScopeApi.setResource(RESOURCE);

    const seen = ScopeApi.isolated("request", { "user.id": "u-1" }, () => {
      const scope = ScopeApi.current();
      ScopeApi.setResource({ "service.name": "billing" });
      return { name: scope.get("service.name"), resource: ScopeApi.resource() };
    });

    expect(seen.name).toBe("billing");
    expect(seen.resource["service.name"]).toBe("billing");
  });

  test("is seen by a child scope created before it", () => {
    const child: Scope = createChildScope(getScopeTree().defaultScope, "request", {});

    ScopeApi.setResource({ "deployment.environment.name": "staging" });

    expect(child.get("deployment.environment.name")).toBe("staging");
  });

  test("leaves a Resource read before it unchanged and frozen", () => {
    ScopeApi.setResource(RESOURCE);
    const before = ScopeApi.resource();

    ScopeApi.setResource({ "service.name": "billing" });

    expect(before["service.name"]).toBe("checkout");
    expect(Object.isFrozen(before)).toBe(true);
    expect(ScopeApi.resource()["service.name"]).toBe("billing");
    expect(Object.isFrozen(ScopeApi.resource())).toBe(true);
  });

  test("set through one copy of the package is read through another", async () => {
    const other = await import("./scope");
    vi.resetModules();
    const mine = await import("./scope");

    other.Scope.setResource({ "service.name": "from-other" });
    expect(mine.Scope.resource()["service.name"]).toBe("from-other");

    mine.Scope.setResource({ "service.version": "from-mine" });
    expect(other.Scope.resource()).toEqual(mine.Scope.resource());
    expect(other.Scope.resource()["service.version"]).toBe("from-mine");
  });
});
