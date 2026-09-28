import { describe, expect, test } from "vitest";
import { isolatedScope, type ScopeMethodDecorator, scoped } from "./decorators";
import { getScopeTree, ReservedScopeKeyError } from "./root";
import { Scope } from "./scope";

// The test transform leaves `@decorator` syntax untouched and neither runtime parses it natively,
// so each dialect's decorator is applied here the way its own runtime applies it: the standard one
// with the method and a method context, its return value replacing the method; the legacy one
// (`experimentalDecorators`) with the prototype, the key and the property descriptor, its return
// value redefining the property.

type MethodKey = "describe" | "describeLater";

class Orders {
  readonly service = "orders";

  describe(id: string): { service: string; id: string; tag: string | undefined; user: unknown } {
    const scope = Scope.current();
    return { service: this.service, id, tag: scope.tag, user: scope.get("user.id") };
  }

  async describeLater(id: string): Promise<{ service: string; id: string; tag: string | undefined }> {
    const tag = Scope.current().tag;
    await Promise.resolve();
    return { service: this.service, id, tag };
  }
}

function applyStandard(cls: typeof Orders, key: MethodKey, decorator: ScopeMethodDecorator): void {
  const method = cls.prototype[key] as (this: Orders, id: string) => unknown;
  const context: ClassMethodDecoratorContext<Orders, typeof method> = {
    kind: "method",
    name: key,
    static: false,
    private: false,
    access: { has: (object) => key in object, get: (object) => object[key] },
    addInitializer: () => undefined,
    metadata: {},
  };
  Object.defineProperty(cls.prototype, key, { value: decorator(method, context) });
}

function applyLegacy(cls: typeof Orders, key: MethodKey, decorator: ScopeMethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, key) as TypedPropertyDescriptor<(this: Orders, id: string) => unknown>;
  Object.defineProperty(cls.prototype, key, decorator(cls.prototype, key, descriptor));
}

/** A fresh subclass per test, so one test's decorated method never reaches another's. */
function decorated(apply: typeof applyStandard, key: MethodKey, decorator: ScopeMethodDecorator): Orders {
  class Decorated extends Orders {}
  Object.defineProperty(Decorated.prototype, key, { value: Orders.prototype[key], writable: true, configurable: true });
  apply(Decorated, key, decorator);
  return new Decorated();
}

describe.for([
  ["standard", applyStandard],
  ["legacy", applyLegacy],
] as const)("under %s decorators", ([, apply]) => {
  describe(isolatedScope.name, () => {
    test("runs the method with its own this and arguments, and returns what it returns", () => {
      const orders = decorated(apply, "describe", isolatedScope("load order"));

      expect(orders.describe("o-1")).toMatchObject({ service: "orders", id: "o-1" });
    });

    test("runs the method in a scope carrying the tag, and restores the enclosing scope after", () => {
      const orders = decorated(apply, "describe", isolatedScope("load order"));

      expect(orders.describe("o-1").tag).toBe("load order");
      expect(Scope.current()).toBe(getScopeTree().defaultScope);
    });

    test("hangs the method's scope off the root, whatever scope is current at the call", () => {
      const orders = decorated(apply, "describe", isolatedScope("load order"));

      const seen = Scope.isolated("request", { "user.id": "u-1" }, () => orders.describe("o-1"));

      expect(seen.user).toBeUndefined();
    });

    test("an async method's caller awaits the resolved value, and no scope is left current after", async () => {
      const orders = decorated(apply, "describeLater", isolatedScope("load order"));

      const result = await orders.describeLater("o-1");

      expect(result).toEqual({ service: "orders", id: "o-1", tag: "load order" });
      expect(Scope.current()).toBe(getScopeTree().defaultScope);
    });
  });

  describe(scoped.name, () => {
    test("runs the method with its own this and arguments, and returns what it returns", () => {
      const orders = decorated(apply, "describe", scoped("load order", {}));

      expect(orders.describe("o-1")).toMatchObject({ service: "orders", id: "o-1" });
    });

    test("runs the method in a scope carrying the tag and attributes, and restores the enclosing scope after", () => {
      const orders = decorated(apply, "describe", scoped("load order", { "user.id": "u-2" }));

      expect(orders.describe("o-1")).toMatchObject({ tag: "load order", user: "u-2" });
      expect(Scope.current()).toBe(getScopeTree().defaultScope);
    });

    test("hangs the method's scope off the scope current at the call", () => {
      const orders = decorated(apply, "describe", scoped("load order", {}));

      const seen = Scope.isolated("request", { "user.id": "u-1" }, () => orders.describe("o-1"));

      expect(seen.user).toBe("u-1");
    });

    test("an async method's caller awaits the resolved value, and no scope is left current after", async () => {
      const orders = decorated(apply, "describeLater", scoped("load order", {}));

      const result = await Scope.isolated("request", {}, () => orders.describeLater("o-1"));

      expect(result).toEqual({ service: "orders", id: "o-1", tag: "load order" });
      expect(Scope.current()).toBe(getScopeTree().defaultScope);
    });

    test("refuses, at each call and before the method runs, an attribute the root holds", () => {
      const orders = decorated(apply, "describe", scoped("load order", { "service.name": "x" }));

      expect(() => orders.describe("o-1")).toThrow(ReservedScopeKeyError);
    });
  });
});

test("a legacy decorator keeps the rest of the method's property descriptor", () => {
  class Decorated extends Orders {}
  Object.defineProperty(Decorated.prototype, "describe", {
    value: Orders.prototype.describe,
    writable: false,
    enumerable: false,
    configurable: true,
  });

  applyLegacy(Decorated, "describe", scoped("load order", {}));

  expect(Object.getOwnPropertyDescriptor(Decorated.prototype, "describe")).toMatchObject({
    writable: false,
    enumerable: false,
    configurable: true,
  });
});
