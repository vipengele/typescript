import { describe, expect, test } from "vitest";
import type { ContextCarrier } from "../context";
import { getOrCreateRegistryEntry } from "../context/global-registry";
import { getScopeTree, isReservedScopeKeyError, ReservedScopeKeyError } from "./root";
import { Scope } from "./scope";
import { getScopeStore } from "./store";

// Every scope below is entered through a callback, so nothing is left current between tests, and
// no test writes to the realm's shared default scope.

function errorOf(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected fn to throw");
}

describe("Scope.current", () => {
  test("is the realm's default scope outside any propagation", () => {
    expect(Scope.current()).toBe(getScopeTree().defaultScope);
  });

  test("refuses set on a key the root holds", () => {
    expect(isReservedScopeKeyError(errorOf(() => Scope.current().set("service.name", "x")))).toBe(true);
  });
});

describe("Scope.propagate", () => {
  test("makes a scope current for fn, and restores the enclosing one once fn returns", () => {
    const request = Scope.isolated("request", {}, () => Scope.current());

    expect(Scope.propagate(request, () => Scope.current())).toBe(request);
    expect(Scope.current()).toBe(getScopeTree().defaultScope);
  });

  test("the single-argument form reinstalls the scope current when it was called", () => {
    const later = Scope.isolated("request", { "user.id": "u-1" }, () => Scope.propagate(() => Scope.current().get("user.id")));

    expect(Scope.current().get("user.id")).toBeUndefined();
    expect(later()).toBe("u-1");
  });

  test("the single-argument form passes arguments through", () => {
    const add = Scope.propagate((a: number, b: number) => a + b);

    expect(add(2, 3)).toBe(5);
  });
});

describe("Scope.inherit", () => {
  test("runs fn with a child of the current scope carrying the tag and attributes", () => {
    Scope.isolated("request", { "user.id": "u-1" }, () => {
      const request = Scope.current();

      const step = Scope.inherit("load order", { "order.id": "o-1" }, () => Scope.current());

      expect(step).not.toBe(request);
      expect(step.tag).toBe("load order");
      expect(step.get("order.id")).toBe("o-1");
      expect(step.get("user.id")).toBe("u-1");
      expect(Scope.current()).toBe(request);
    });
  });

  test("a child sees a value its parent sets after the child was created, and never the other way", () => {
    Scope.isolated("request", {}, () => {
      const request = Scope.current();

      Scope.inherit("step", {}, () => {
        request.set("user.id", "u-1");
        Scope.current().set("order.id", "o-1");

        expect(Scope.current().get("user.id")).toBe("u-1");
      });

      expect(request.get("order.id")).toBeUndefined();
    });
  });

  test("returns what fn returns", () => {
    expect(Scope.inherit("step", {}, () => 42)).toBe(42);
  });

  test("refuses an attribute the root holds, without calling fn", () => {
    let called = false;

    expect(() =>
      Scope.inherit("step", { "service.version": "9.9.9" }, () => {
        called = true;
      }),
    ).toThrow(ReservedScopeKeyError);
    expect(called).toBe(false);
  });

  test("the child refuses set on a key the root holds", () => {
    Scope.inherit("step", {}, () => {
      expect(() => Scope.current().set("deployment.environment.name", "staging")).toThrow(ReservedScopeKeyError);
    });
  });

  test("two calls one after another in the same frame are siblings, both children of the scope current before either", () => {
    Scope.isolated("request", { "user.id": "u-1" }, () => {
      const request = Scope.current();

      const first = Scope.inherit("first", { "first.only": true }, () => Scope.current());
      const second = Scope.inherit("second", {}, () => Scope.current());

      expect(Scope.current()).toBe(request);
      expect(second.get("first.only")).toBeUndefined();
      expect(second.get("user.id")).toBe("u-1");

      request.set("request.late", "late");
      expect(first.get("request.late")).toBe("late");
      expect(second.get("request.late")).toBe("late");
    });
  });
});

describe("Scope.isolated", () => {
  test("runs fn with a child of the root carrying the tag and attributes", () => {
    const request = Scope.isolated("request", { "user.id": "u-1" }, () => Scope.current());

    expect(request.tag).toBe("request");
    expect(request.get("user.id")).toBe("u-1");
    expect(Scope.current()).toBe(getScopeTree().defaultScope);
  });

  test("hangs off the root, never off the scope current when it is called", () => {
    Scope.isolated("outer request", { "user.id": "outer" }, () => {
      Scope.inherit("step", { "step.id": "s-1" }, () => {
        const enclosing = Scope.current();

        const inner = Scope.isolated("inner request", {}, () => Scope.current());

        expect(inner.get("user.id")).toBeUndefined();
        expect(inner.get("step.id")).toBeUndefined();
        expect(Scope.current()).toBe(enclosing);
      });
    });
  });

  test("reads the root's Resource keys and refuses to set them", () => {
    Scope.isolated("request", {}, () => {
      expect(Scope.current().get("service.name")).toBe(getScopeTree().root.get("service.name"));
      expect(() => Scope.current().set("process.runtime.name", "deno")).toThrow(ReservedScopeKeyError);
    });
  });

  test("refuses an attribute the root holds", () => {
    expect(() => Scope.isolated("request", { "service.name": "x" }, () => undefined)).toThrow(ReservedScopeKeyError);
  });
});

describe("nesting", () => {
  test("each level is current at its own depth, and its enclosing scope is back once it returns", () => {
    const defaultScope = getScopeTree().defaultScope;

    Scope.isolated("request", {}, () => {
      const request = Scope.current();
      expect(request.tag).toBe("request");

      Scope.inherit("step", {}, () => {
        const step = Scope.current();
        expect(step.tag).toBe("step");

        Scope.inherit("substep", {}, () => {
          expect(Scope.current().tag).toBe("substep");
        });

        expect(Scope.current()).toBe(step);
      });

      expect(Scope.current()).toBe(request);
    });

    expect(Scope.current()).toBe(defaultScope);
  });

  test("a throwing fn still restores each enclosing scope on its way out", () => {
    const defaultScope = getScopeTree().defaultScope;
    const failure = new Error("boom");
    let request: Scope | undefined;
    let step: Scope | undefined;
    let afterSubstep: Scope | undefined;
    let afterStep: Scope | undefined;

    const thrown = errorOf(() =>
      Scope.isolated("request", {}, () => {
        request = Scope.current();
        try {
          Scope.inherit("step", {}, () => {
            step = Scope.current();
            try {
              Scope.inherit("substep", {}, () => {
                throw failure;
              });
            } finally {
              afterSubstep = Scope.current();
            }
          });
        } finally {
          afterStep = Scope.current();
        }
      }),
    );

    expect(thrown).toBe(failure);
    expect(afterSubstep).toBe(step);
    expect(afterStep).toBe(request);
    expect(Scope.current()).toBe(defaultScope);
  });
});

describe("Scope.useCarrier", () => {
  /** A synchronous stack that records every call, so a test can tell it was the one used. */
  function recordingCarrier(defaultValue: Scope): ContextCarrier<Scope> & { readonly calls: string[] } {
    const stack: Scope[] = [];
    const calls: string[] = [];
    return {
      calls,
      current: () => {
        calls.push("current");
        return stack[stack.length - 1] ?? defaultValue;
      },
      run: (value, fn) => {
        calls.push(`run:${value.tag}`);
        stack.push(value);
        try {
          return fn();
        } finally {
          stack.pop();
        }
      },
    };
  }

  /** Installs `carrier` for the duration of `fn`, then puts back the carrier the scope store had before. */
  function withCarrier(carrier: ContextCarrier<Scope>, fn: () => void): void {
    const entry = getOrCreateRegistryEntry<Scope>("scope", () => {
      throw new Error("the scope store fills its slot before a carrier is installed");
    });
    const original = entry.get();
    Scope.useCarrier(carrier);
    try {
      fn();
    } finally {
      entry.set(original);
    }
  }

  test("routes current, propagate, inherit and isolated through the installed carrier", () => {
    const carrier = recordingCarrier(getScopeTree().defaultScope);

    withCarrier(carrier, () => {
      expect(Scope.current()).toBe(getScopeTree().defaultScope);

      const later = Scope.isolated("request", { "user.id": "u-1" }, () =>
        Scope.inherit("step", {}, () => Scope.propagate(() => Scope.current().get("user.id"))),
      );

      expect(later()).toBe("u-1");
      expect(carrier.calls).toEqual(["current", "run:request", "current", "run:step", "current", "run:step", "current"]);
    });
  });

  test("applies to every handle on the scope store", () => {
    const carrier = recordingCarrier(getScopeTree().defaultScope);

    withCarrier(carrier, () => {
      expect(getScopeStore().propagate(getScopeTree().defaultScope, () => "ran")).toBe("ran");
      expect(carrier.calls).toEqual(["run:undefined"]);
    });
  });
});
