import { describe, expect, test } from "vitest";
import { isReservedScopeKeyError, snapshot } from "./root";
import { Scope } from "./scope";

function keysOf(scope: Scope): string[] {
  return Object.keys(snapshot(scope)).sort();
}

describe("Scope.setUser", () => {
  test("writes user.id, user.email and user.username to the current scope", () => {
    Scope.isolated("request", {}, () => {
      Scope.setUser({ id: "u-1", email: "a@b.c", username: "ann" });

      expect(Scope.current().get("user.id")).toBe("u-1");
      expect(Scope.current().get("user.email")).toBe("a@b.c");
      expect(Scope.current().get("user.username")).toBe("ann");
    });
  });

  test("skips undefined fields", () => {
    Scope.isolated("request", {}, () => {
      Scope.setUser({ id: undefined, email: undefined, username: "ann" });

      expect(snapshot(Scope.current())).toEqual({ "user.username": "ann" });
    });
  });

  test("writes nothing for an empty user", () => {
    Scope.isolated("request", {}, () => {
      Scope.setUser({});

      expect(keysOf(Scope.current())).toEqual([]);
    });
  });

  test("is visible to a child scope and gone from the parent after the child exits", () => {
    Scope.isolated("request", {}, () => {
      Scope.inherit("step", {}, () => {
        Scope.setUser({ id: "u-1" });
        expect(Scope.current().get("user.id")).toBe("u-1");
      });

      expect(Scope.current().get("user.id")).toBeUndefined();
    });
  });

  test("is not visible from an isolated scope", () => {
    Scope.isolated("request", {}, () => {
      Scope.setUser({ id: "u-1" });
      Scope.isolated("other", {}, () => {
        expect(Scope.current().get("user.id")).toBeUndefined();
      });
    });
  });

  test("appears in snapshot", () => {
    Scope.isolated("request", {}, () => {
      Scope.setUser({ id: "u-1", email: "a@b.c" });

      expect(snapshot(Scope.current())).toEqual({ "user.id": "u-1", "user.email": "a@b.c" });
    });
  });
});

describe("Scope.setTag", () => {
  test("writes the plain key to the current scope", () => {
    Scope.isolated("request", {}, () => {
      Scope.setTag("region", "eu");

      expect(snapshot(Scope.current())).toEqual({ region: "eu" });
    });
  });

  test("keeps an undefined value as a shadowing attribute", () => {
    Scope.isolated("request", { region: "eu" }, () => {
      Scope.inherit("step", {}, () => {
        Scope.setTag("region", undefined);

        expect(snapshot(Scope.current())).toEqual({ region: undefined });
      });
    });
  });

  test("throws ReservedScopeKeyError for a root key and writes nothing", () => {
    Scope.isolated("request", {}, () => {
      let thrown: unknown;
      try {
        Scope.setTag("service.name", "x");
      } catch (error) {
        thrown = error;
      }

      expect(isReservedScopeKeyError(thrown)).toBe(true);
      expect(keysOf(Scope.current())).toEqual([]);
    });
  });

  test("is visible to a child scope and gone from the parent after the child exits", () => {
    Scope.isolated("request", {}, () => {
      Scope.inherit("step", {}, () => {
        Scope.setTag("region", "eu");
        expect(Scope.current().get("region")).toBe("eu");
      });

      expect(Scope.current().get("region")).toBeUndefined();
    });
  });

  test("is not visible from an isolated scope", () => {
    Scope.isolated("request", {}, () => {
      Scope.setTag("region", "eu");
      Scope.isolated("other", {}, () => {
        expect(Scope.current().get("region")).toBeUndefined();
      });
    });
  });
});

describe("Scope.setContext", () => {
  test("writes name.field keys one level deep and keeps nested values whole", () => {
    Scope.isolated("request", {}, () => {
      const nested = { deep: true };
      Scope.setContext("order", { total: 12, "line.count": 3, nested });

      const attributes = snapshot(Scope.current());
      expect(attributes).toEqual({ "order.total": 12, "order.line.count": 3, "order.nested": nested });
      expect(attributes["order.nested"]).toBe(nested);
    });
  });

  test("writes nothing for empty data", () => {
    Scope.isolated("request", {}, () => {
      Scope.setContext("order", {});

      expect(keysOf(Scope.current())).toEqual([]);
    });
  });

  test("keeps an undefined field value", () => {
    Scope.isolated("request", {}, () => {
      Scope.setContext("order", { total: undefined });

      expect(snapshot(Scope.current())).toEqual({ "order.total": undefined });
    });
  });

  test("validates every key before writing, so a reserved key leaves nothing written", () => {
    Scope.isolated("request", {}, () => {
      let thrown: unknown;
      try {
        Scope.setContext("service", { id: "a", name: "b" });
      } catch (error) {
        thrown = error;
      }

      expect(isReservedScopeKeyError(thrown)).toBe(true);
      expect(keysOf(Scope.current())).toEqual([]);
    });
  });

  test.each([["" as string], [undefined as unknown as string], [42 as unknown as string]])(
    "throws a TypeError for the invalid name %j and writes nothing",
    (name) => {
      Scope.isolated("request", {}, () => {
        expect(() => Scope.setContext(name, { a: 1 })).toThrow(TypeError);
        expect(keysOf(Scope.current())).toEqual([]);
      });
    },
  );

  test("is visible to a child scope and gone from the parent after the child exits", () => {
    Scope.isolated("request", {}, () => {
      Scope.inherit("step", {}, () => {
        Scope.setContext("order", { total: 1 });
        expect(Scope.current().get("order.total")).toBe(1);
      });

      expect(Scope.current().get("order.total")).toBeUndefined();
    });
  });

  test("is not visible from an isolated scope", () => {
    Scope.isolated("request", {}, () => {
      Scope.setContext("order", { total: 1 });
      Scope.isolated("other", {}, () => {
        expect(Scope.current().get("order.total")).toBeUndefined();
      });
    });
  });
});
