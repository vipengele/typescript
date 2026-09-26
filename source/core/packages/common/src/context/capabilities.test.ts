import { describe, expect, test, vi } from "vitest";
import { type CapabilitySource, resolveAsyncContextVariable, resolveAsyncLocalStorage } from "./capabilities";

class FakeAsyncLocalStorage {}
class FakeAsyncContextVariable {}

function nodeLike(asyncHooks: unknown): CapabilitySource {
  return { process: { getBuiltinModule: () => asyncHooks } };
}

describe(resolveAsyncLocalStorage.name, () => {
  test("resolves AsyncLocalStorage from node:async_hooks through getBuiltinModule", () => {
    const getBuiltinModule = vi.fn(() => ({ AsyncLocalStorage: FakeAsyncLocalStorage }));
    const runtime = { getBuiltinModule };

    expect(resolveAsyncLocalStorage({ process: runtime })).toBe(FakeAsyncLocalStorage);
    expect(getBuiltinModule).toHaveBeenCalledWith("node:async_hooks");
    expect(getBuiltinModule.mock.contexts[0]).toBe(runtime);
  });

  test("a source without process resolves nothing", () => {
    expect(resolveAsyncLocalStorage({})).toBeUndefined();
  });

  test("a process polyfill without getBuiltinModule resolves nothing", () => {
    expect(resolveAsyncLocalStorage({ process: {} })).toBeUndefined();
  });

  test("a getBuiltinModule that is not a function resolves nothing", () => {
    expect(resolveAsyncLocalStorage({ process: { getBuiltinModule: "not a function" } })).toBeUndefined();
  });

  test("a runtime that does not know node:async_hooks resolves nothing", () => {
    expect(resolveAsyncLocalStorage(nodeLike(undefined))).toBeUndefined();
  });

  test("a node:async_hooks without AsyncLocalStorage resolves nothing", () => {
    expect(resolveAsyncLocalStorage(nodeLike({}))).toBeUndefined();
  });

  test("an AsyncLocalStorage that is not a constructor resolves nothing", () => {
    expect(resolveAsyncLocalStorage(nodeLike({ AsyncLocalStorage: {} }))).toBeUndefined();
  });

  test("the source is read on every call, never cached", () => {
    const source: { process?: { getBuiltinModule: () => unknown } } = {};

    expect(resolveAsyncLocalStorage(source)).toBeUndefined();

    source.process = { getBuiltinModule: () => ({ AsyncLocalStorage: FakeAsyncLocalStorage }) };
    expect(resolveAsyncLocalStorage(source)).toBe(FakeAsyncLocalStorage);
  });

  test("without a source, globalThis decides", () => {
    const runtime = (globalThis as CapabilitySource).process;
    const available = typeof runtime?.getBuiltinModule === "function";

    expect(resolveAsyncLocalStorage() !== undefined).toBe(available);
  });
});

describe(resolveAsyncContextVariable.name, () => {
  test("resolves AsyncContext.Variable", () => {
    expect(resolveAsyncContextVariable({ AsyncContext: { Variable: FakeAsyncContextVariable } })).toBe(FakeAsyncContextVariable);
  });

  test("a source without AsyncContext resolves nothing", () => {
    expect(resolveAsyncContextVariable({})).toBeUndefined();
  });

  test("an AsyncContext without Variable resolves nothing", () => {
    expect(resolveAsyncContextVariable({ AsyncContext: {} })).toBeUndefined();
  });

  test("a Variable that is not a constructor resolves nothing", () => {
    expect(resolveAsyncContextVariable({ AsyncContext: { Variable: {} } })).toBeUndefined();
  });

  test("the source is read on every call, never cached", () => {
    const source: { AsyncContext?: { Variable: unknown } } = {};

    expect(resolveAsyncContextVariable(source)).toBeUndefined();

    source.AsyncContext = { Variable: FakeAsyncContextVariable };
    expect(resolveAsyncContextVariable(source)).toBe(FakeAsyncContextVariable);
  });

  test("without a source, globalThis decides", () => {
    const variable = (globalThis as CapabilitySource).AsyncContext?.Variable;

    expect(resolveAsyncContextVariable()).toBe(typeof variable === "function" ? variable : undefined);
  });
});
