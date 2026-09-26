import { afterEach, expect, test } from "vitest";
import { type ContextCarrier, createAsyncContextStore, resolveDefaultCarrier } from "./async-context-store";
import type { CapabilitySource } from "./capabilities";
import { getOrCreateRegistryEntry } from "./global-registry";

let keys = 0;

/** A key no other test has used, since registry slots live on globalThis for the whole run. */
function freshKey(): string {
  keys += 1;
  return `async-context-store-test-${keys}`;
}

/** A synchronous stack double of both `AsyncLocalStorage` and `AsyncContext.Variable`. */
class FakeStorage<T> {
  readonly options: { defaultValue: T } | undefined;
  private readonly stack: T[] = [];

  constructor(options?: { defaultValue: T }) {
    this.options = options;
  }

  run<R>(value: T, fn: () => R): R {
    this.stack.push(value);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }

  getStore(): T | undefined {
    return this.stack[this.stack.length - 1];
  }

  get(): T | undefined {
    return this.stack.length === 0 ? this.options?.defaultValue : this.stack[this.stack.length - 1];
  }
}

class FakeAsyncLocalStorage<T> extends FakeStorage<T> {}
class FakeAsyncContextVariable<T> extends FakeStorage<T> {}

/** A carrier that records every call, so a test can tell it was the one used. */
function recordingCarrier(defaultValue: string): ContextCarrier<string> & { readonly calls: string[] } {
  const stack: string[] = [];
  const calls: string[] = [];
  return {
    calls,
    current: () => {
      calls.push("current");
      return stack.length === 0 ? defaultValue : (stack[stack.length - 1] as string);
    },
    run: (value, fn) => {
      calls.push(`run:${value}`);
      stack.push(value);
      try {
        return fn();
      } finally {
        stack.pop();
      }
    },
  };
}

const restorers: (() => void)[] = [];

afterEach(() => {
  for (const restore of restorers.splice(0)) {
    restore();
  }
});

/** Installs `carrier` on the store and restores the key's original carrier after the test. */
function installCarrier(key: string, carrier: ContextCarrier<string>): void {
  const entry = getOrCreateRegistryEntry<string>(key, () => {
    throw new Error("the store fills the slot before a carrier is installed");
  });
  const original = entry.get();
  restorers.push(() => entry.set(original));
  createAsyncContextStore(key, "default").useCarrier(carrier);
}

test("current() is the default before anything is propagated", () => {
  expect(createAsyncContextStore(freshKey(), "default").current()).toBe("default");
});

test("propagate installs the value for fn and returns what fn returns", () => {
  const store = createAsyncContextStore(freshKey(), "default");

  expect(store.propagate("installed", () => store.current())).toBe("installed");
});

test("a nested propagate restores the outer value on exit, not the default", () => {
  const store = createAsyncContextStore(freshKey(), "default");

  const seen = store.propagate("outer", () => {
    const inner = store.propagate("inner", () => store.current());
    return [inner, store.current()];
  });

  expect(seen).toEqual(["inner", "outer"]);
  expect(store.current()).toBe("default");
});

test("a throwing fn leaves the enclosing value current once the caller catches", () => {
  const store = createAsyncContextStore(freshKey(), "default");
  const failure = new Error("fn failed");

  const seen = store.propagate("outer", () => {
    expect(() =>
      store.propagate("inner", () => {
        throw failure;
      }),
    ).toThrow(failure);
    return store.current();
  });

  expect(seen).toBe("outer");
  expect(store.current()).toBe("default");
});

test("propagate(fn) calls fn with the value current when it was captured, not when it is called", () => {
  const store = createAsyncContextStore(freshKey(), "default");

  const bound = store.propagate("captured", () => store.propagate((suffix: string) => `${store.current()}${suffix}`));

  expect(store.current()).toBe("default");
  expect(bound("!")).toBe("captured!");
  expect(store.propagate("later", () => bound("?"))).toBe("captured?");
  expect(store.current()).toBe("default");
});

test("stores created with the same key share one context", () => {
  const key = freshKey();
  const a = createAsyncContextStore(key, "first");
  const b = createAsyncContextStore(key, "second");

  expect(b.current()).toBe("first");
  expect(a.propagate("installed", () => b.current())).toBe("installed");
});

test("useCarrier routes current() and propagate through the installed carrier", () => {
  const key = freshKey();
  const store = createAsyncContextStore(key, "default");
  const carrier = recordingCarrier("stub-default");

  installCarrier(key, carrier);

  expect(store.current()).toBe("stub-default");
  expect(store.propagate("installed", () => store.current())).toBe("installed");
  const bound = store.propagate(() => store.current());
  expect(bound()).toBe("stub-default");
  expect(carrier.calls).toEqual(["current", "run:installed", "current", "current", "run:stub-default", "current"]);
});

test("useCarrier on one store applies to every store holding the key", () => {
  const key = freshKey();
  const before = createAsyncContextStore(key, "default");

  installCarrier(key, recordingCarrier("stub-default"));

  expect(before.current()).toBe("stub-default");
  expect(createAsyncContextStore(key, "default").current()).toBe("stub-default");
});

test("the default carrier is AsyncLocalStorage when the runtime exposes it, ahead of AsyncContext", () => {
  const source: CapabilitySource = {
    process: { getBuiltinModule: () => ({ AsyncLocalStorage: FakeAsyncLocalStorage }) },
    AsyncContext: {
      Variable: class {
        constructor() {
          throw new Error("AsyncContext is consulted only without AsyncLocalStorage");
        }
      },
    },
  };
  const carrier = resolveDefaultCarrier("default", source);

  expect(carrier.run("installed", () => carrier.current())).toBe("installed");
  expect(carrier.current()).toBe("default");
});

test("the default carrier is AsyncContext.Variable when AsyncLocalStorage is unavailable", () => {
  const source: CapabilitySource = { process: {}, AsyncContext: { Variable: FakeAsyncContextVariable } };
  const carrier = resolveDefaultCarrier("default", source);

  expect(carrier.run("installed", () => carrier.current())).toBe("installed");
  expect(carrier.current()).toBe("default");
});

test("the default carrier is the synchronous stack when neither is available", async () => {
  const carrier = resolveDefaultCarrier("default", {});

  const afterAwait = await carrier.run("installed", async () => {
    await Promise.resolve();
    return carrier.current();
  });

  expect(afterAwait).toBe("default");
});
