import { expect, test } from "vitest";
import type { CapabilitySource } from "../capabilities";
import { createNodeAsyncLocalStorageCarrier } from "./node-async-local-storage-carrier";

/**
 * A synchronous double of `AsyncLocalStorage`, so the carrier's delegation is checked in every
 * runtime the suite runs in. Real propagation across `await` is covered by the `.node.test.ts`
 * suite against Node's own implementation.
 */
class FakeAsyncLocalStorage<T> {
  private readonly stack: T[] = [];

  run<R>(store: T, fn: () => R): R {
    this.stack.push(store);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }

  getStore(): T | undefined {
    return this.stack[this.stack.length - 1];
  }
}

const withAsyncLocalStorage: CapabilitySource = {
  process: { getBuiltinModule: () => ({ AsyncLocalStorage: FakeAsyncLocalStorage }) },
};

test("outside any run, current() is the default", () => {
  const carrier = createNodeAsyncLocalStorageCarrier("default", withAsyncLocalStorage);

  expect(carrier?.current()).toBe("default");
});

test("inside run, current() is the stored value", () => {
  const carrier = createNodeAsyncLocalStorageCarrier("default", withAsyncLocalStorage);

  expect(carrier?.run("installed", () => carrier.current())).toBe("installed");
});

test("a falsy stored value is returned, not replaced by the default", () => {
  const carrier = createNodeAsyncLocalStorageCarrier(1, withAsyncLocalStorage);

  expect(carrier?.run(0, () => carrier.current())).toBe(0);
});

test("a runtime without getBuiltinModule yields no carrier", () => {
  expect(createNodeAsyncLocalStorageCarrier("default", { process: {} })).toBeUndefined();
});

test("a runtime without AsyncLocalStorage yields no carrier", () => {
  expect(createNodeAsyncLocalStorageCarrier("default", { process: { getBuiltinModule: () => undefined } })).toBeUndefined();
});
