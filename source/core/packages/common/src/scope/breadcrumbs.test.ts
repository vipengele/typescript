import { afterEach, describe, expect, test, vi } from "vitest";
import { systemClock } from "../time/clock";
import { type Breadcrumb, type BreadcrumbInput, addBreadcrumb, breadcrumbs } from "./breadcrumbs";
import { createChildScope, createScopeTree, getScopeTree, type Resource, type Scope } from "./root";
import { Scope as ScopeApi } from "./scope";

const PARENT = Symbol.for("vipengele:scope:parent");
const ATTRIBUTES = Symbol.for("vipengele:scope:attributes");
const BREADCRUMBS = Symbol.for("vipengele:scope:breadcrumbs");
const TREE = Symbol.for("vipengele:scope:tree");

const RESOURCE: Resource = {
  "service.name": "checkout",
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
};

/** A scope node built by hand from the `Symbol.for` slots, as another copy of the package would build one. */
function node(parent: unknown, slots: Record<symbol, unknown> = {}): Scope {
  return { tag: undefined, get: () => undefined, set: () => undefined, [PARENT]: parent, [ATTRIBUTES]: {}, ...slots } as Scope;
}

function messages(scope: Scope): string[] {
  return breadcrumbs(scope).map((crumb) => crumb.message);
}

/** The single breadcrumb `input` records into a fresh Unit of Work. */
function recordOne(input: unknown): Breadcrumb | undefined {
  return ScopeApi.isolated("request", {}, () => {
    ScopeApi.addBreadcrumb(input as BreadcrumbInput);
    return breadcrumbs(ScopeApi.current())[0];
  });
}

describe("the breadcrumb buffer", () => {
  test("an isolated scope starts with an empty trail of its own", () => {
    ScopeApi.addBreadcrumb({ message: "outside" });

    ScopeApi.isolated("request", {}, () => {
      expect(breadcrumbs(ScopeApi.current())).toEqual([]);
      ScopeApi.addBreadcrumb({ message: "inside" });
      expect(messages(ScopeApi.current())).toEqual(["inside"]);
    });

    expect(messages(ScopeApi.current())).not.toContain("inside");
  });

  test("an inherited scope shares its parent's trail in both directions", () => {
    ScopeApi.isolated("request", {}, () => {
      const request = ScopeApi.current();
      ScopeApi.addBreadcrumb({ message: "before" });

      ScopeApi.inherit("step", {}, () => {
        expect(messages(ScopeApi.current())).toEqual(["before"]);
        ScopeApi.addBreadcrumb({ message: "during" });
      });

      expect(messages(request)).toEqual(["before", "during"]);
    });
  });

  test("two isolated scopes never see each other's trail", () => {
    const first = ScopeApi.isolated("a", {}, () => {
      ScopeApi.addBreadcrumb({ message: "a" });
      return ScopeApi.current();
    });
    const second = ScopeApi.isolated("b", {}, () => {
      ScopeApi.addBreadcrumb({ message: "b" });
      return ScopeApi.current();
    });

    expect(messages(first)).toEqual(["a"]);
    expect(messages(second)).toEqual(["b"]);
  });

  test("the default scope records into a trail of its own, which a child of it shares", () => {
    const { root, defaultScope } = createScopeTree(RESOURCE);
    const child = createChildScope(defaultScope, "step", {});

    addBreadcrumb(defaultScope, { message: "default" });
    addBreadcrumb(child, { message: "child" });

    expect(messages(defaultScope)).toEqual(["default", "child"]);
    expect(breadcrumbs(root)).toEqual([]);
  });

  test("outside any propagation Scope.addBreadcrumb records into the realm's default scope", () => {
    ScopeApi.addBreadcrumb({ message: "default-trail" });

    expect(messages(getScopeTree().defaultScope).at(-1)).toBe("default-trail");
  });

  test("the root holds a trail of its own, apart from its children's", () => {
    const { root } = createScopeTree(RESOURCE);
    const isolated = createChildScope(root, "request", {});

    addBreadcrumb(root, { message: "root" });

    expect(messages(root)).toEqual(["root"]);
    expect(breadcrumbs(isolated)).toEqual([]);
  });

  test("keeps the newest 100 entries, evicting the oldest", () => {
    ScopeApi.isolated("request", {}, () => {
      for (let index = 0; index < 105; index += 1) {
        ScopeApi.addBreadcrumb({ message: `m${index}` });
      }

      const trail = messages(ScopeApi.current());
      expect(trail).toHaveLength(100);
      expect(trail[0]).toBe("m5");
      expect(trail.at(-1)).toBe("m104");
    });
  });
});

describe("Scope.addBreadcrumb", () => {
  test("stores every given field", () => {
    expect(recordOne({ message: "GET /orders", category: "http", level: "info", data: { status: 200 }, time: 1_700_000_000_000 })).toEqual({
      time: 1_700_000_000_000,
      message: "GET /orders",
      category: "http",
      level: "info",
      data: { status: 200 },
    });
  });

  test("leaves absent optional fields out rather than undefined", () => {
    const crumb = recordOne({ message: "m", time: 1 });

    expect(Object.keys(crumb as object).sort()).toEqual(["message", "time"]);
  });

  test.for([undefined, Number.NaN, Number.POSITIVE_INFINITY, "1", null])("reads systemClock when time is %o", (time) => {
    const before = systemClock();
    const recorded = recordOne({ message: "m", time })?.time as number;
    const after = systemClock();

    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(after);
  });

  test("normalizes data when the breadcrumb is recorded", () => {
    const at = new Date(Date.UTC(2026, 0, 2));

    expect(recordOne({ message: "m", data: { at, tags: new Set(["a"]), size: 10n } })?.data).toEqual({
      at: "2026-01-02T00:00:00.000Z",
      tags: ["a"],
      size: "10n",
    });
  });

  test("deep-freezes the entry, so a caller's later change to its data never reaches the trail", () => {
    const data = { nested: { list: [1, { deep: "x" }] } };

    const crumb = recordOne({ message: "m", data }) as Breadcrumb;
    data.nested.list.push(2);
    (data.nested.list[1] as { deep: string }).deep = "changed";

    expect(crumb.data).toEqual({ nested: { list: [1, { deep: "x" }] } });
    expect(Object.isFrozen(crumb)).toBe(true);
    expect(Object.isFrozen(crumb.data)).toBe(true);
    const nested = (crumb.data as { nested: { list: [number, object] } }).nested;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.list)).toBe(true);
    expect(Object.isFrozen(nested.list[1])).toBe(true);
  });

  test.for([undefined, null, 42, "m", ["m"]])("drops an input of %o", (input) => {
    expect(recordOne(input)).toBeUndefined();
  });

  test.for([undefined, 42, null, { text: "m" }])("drops an entry whose message is %o", (message) => {
    expect(recordOne({ message, category: "http" })).toBeUndefined();
  });

  test("drops an entry whose fields throw when read, without throwing", () => {
    const input = {
      get message(): string {
        throw new Error("unreadable");
      },
    };

    expect(recordOne(input)).toBeUndefined();
  });

  test.for([
    ["category", 42],
    ["category", null],
    ["level", "verbose"],
    ["level", "off"],
    ["level", "constructor"],
    ["data", "text"],
    ["data", null],
    ["data", [1, 2]],
  ] as const)("leaves out only a %s of %o", ([field, value]) => {
    const crumb = recordOne({ message: "m", time: 1, [field]: value });

    expect(crumb).toEqual({ message: "m", time: 1 });
    expect(Object.hasOwn(crumb as object, field)).toBe(false);
  });
});

describe(breadcrumbs.name, () => {
  test("returns a copy, oldest first, that the caller may change without touching the trail", () => {
    ScopeApi.isolated("request", {}, () => {
      ScopeApi.addBreadcrumb({ message: "first" });
      ScopeApi.addBreadcrumb({ message: "second" });

      const copy = breadcrumbs(ScopeApi.current());
      copy.length = 0;

      expect(messages(ScopeApi.current())).toEqual(["first", "second"]);
      expect(breadcrumbs(ScopeApi.current())).not.toBe(breadcrumbs(ScopeApi.current()));
    });
  });

  test("reads a slot that throws as an empty trail", () => {
    const scope = node(undefined);
    Object.defineProperty(scope, BREADCRUMBS, {
      get() {
        throw new Error("unreadable");
      },
    });

    expect(breadcrumbs(scope)).toEqual([]);
    expect(() => addBreadcrumb(scope, { message: "m" })).not.toThrow();
  });
});

describe("a scope another copy of the package built without the slot", () => {
  test("reads as an empty trail and ignores addBreadcrumb", () => {
    const slotless = node(node(undefined));

    addBreadcrumb(slotless, { message: "m" });

    expect(breadcrumbs(slotless)).toEqual([]);
    expect(Object.hasOwn(slotless, BREADCRUMBS)).toBe(false);
  });

  test("ignores a slot that holds something other than an array", () => {
    const scope = node(undefined, { [BREADCRUMBS]: { length: 0 } });

    addBreadcrumb(scope, { message: "m" });

    expect(breadcrumbs(scope)).toEqual([]);
  });

  test("passes no trail on to a child of it", () => {
    const slotless = node(node(undefined));
    const child = createChildScope(slotless, "step", {});

    addBreadcrumb(child, { message: "m" });

    expect(breadcrumbs(child)).toEqual([]);
  });

  test("as the root, still gives an isolated child a fresh trail", () => {
    const child = createChildScope(node(undefined), "request", {});

    addBreadcrumb(child, { message: "m" });

    expect(messages(child)).toEqual(["m"]);
  });
});

describe("across two copies of the package", () => {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  const original = registry[TREE];

  afterEach(() => {
    registry[TREE] = original;
    vi.resetModules();
  });

  test("one copy reads and appends to the trail another copy records into", async () => {
    const other = await import("./scope");
    const otherReader = await import("./breadcrumbs");
    vi.resetModules();
    const mine = await import("./scope");
    const myReader = await import("./breadcrumbs");

    other.Scope.isolated("request", {}, () => {
      other.Scope.addBreadcrumb({ message: "from-other" });
      const request = other.Scope.current();

      mine.Scope.propagate(request, () => {
        mine.Scope.addBreadcrumb({ message: "from-mine" });
      });

      expect(myReader.breadcrumbs(request).map((crumb) => crumb.message)).toEqual(["from-other", "from-mine"]);
      expect(otherReader.breadcrumbs(request).map((crumb) => crumb.message)).toEqual(["from-other", "from-mine"]);
    });
  });
});
