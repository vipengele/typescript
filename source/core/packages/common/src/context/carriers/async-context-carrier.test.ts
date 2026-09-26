import { expect, test, vi } from "vitest";
import type { CapabilitySource } from "../capabilities";
import { createAsyncContextCarrier } from "./async-context-carrier";

/**
 * A double of the TC39 `AsyncContext.Variable` shape. No runtime the suite runs in ships
 * `AsyncContext`, so these tests prove the carrier drives the proposal's API correctly; they
 * cannot prove propagation across an `await`, which only a real engine implements.
 */
class FakeAsyncContextVariable<T> {
  static readonly instances: FakeAsyncContextVariable<unknown>[] = [];

  readonly options: { defaultValue: T };
  private readonly stack: T[] = [];

  constructor(options: { defaultValue: T }) {
    this.options = options;
    FakeAsyncContextVariable.instances.push(this);
  }

  run<R>(value: T, fn: () => R): R {
    this.stack.push(value);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }

  get(): T {
    return this.stack.length === 0 ? this.options.defaultValue : (this.stack[this.stack.length - 1] as T);
  }
}

const withAsyncContext: CapabilitySource = { AsyncContext: { Variable: FakeAsyncContextVariable } };

test("constructs one AsyncContext.Variable with the default", () => {
  FakeAsyncContextVariable.instances.length = 0;

  createAsyncContextCarrier("default", withAsyncContext);

  expect(FakeAsyncContextVariable.instances).toHaveLength(1);
  expect(FakeAsyncContextVariable.instances[0]?.options).toEqual({ defaultValue: "default" });
});

test("outside any run, current() is the variable's get()", () => {
  const carrier = createAsyncContextCarrier("default", withAsyncContext);

  expect(carrier?.current()).toBe("default");
});

test("run delegates to the variable's run with the value and fn", () => {
  const run = vi.spyOn(FakeAsyncContextVariable.prototype, "run");
  const carrier = createAsyncContextCarrier("default", withAsyncContext);
  const fn = () => carrier?.current();

  expect(carrier?.run("installed", fn)).toBe("installed");
  expect(run).toHaveBeenCalledWith("installed", fn);

  run.mockRestore();
});

test("a nested run restores the outer value on exit", () => {
  const carrier = createAsyncContextCarrier("default", withAsyncContext);

  const seen = carrier?.run("outer", () => [carrier.run("inner", () => carrier.current()), carrier.current()]);

  expect(seen).toEqual(["inner", "outer"]);
  expect(carrier?.current()).toBe("default");
});

test("an engine without AsyncContext yields no carrier", () => {
  expect(createAsyncContextCarrier("default", {})).toBeUndefined();
});

test("without a source, the carrier exists only where globalThis ships AsyncContext.Variable", () => {
  const variable = (globalThis as CapabilitySource).AsyncContext?.Variable;

  expect(createAsyncContextCarrier("default") !== undefined).toBe(typeof variable === "function");
});
