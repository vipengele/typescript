/**
 * The slice of `AsyncLocalStorage` from `node:async_hooks` the Node carrier uses. It is declared
 * structurally rather than through `import type` so the package type-checks without `@types/node`.
 */
export interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

export type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>;

/** The slice of the TC39 `AsyncContext.Variable` proposal the async-context carrier uses. */
export interface AsyncContextVariableLike<T> {
  run<R>(value: T, fn: () => R): R;
  get(): T;
}

export type AsyncContextVariableConstructor = new <T>(options: { defaultValue: T }) => AsyncContextVariableLike<T>;

/**
 * Where capabilities are looked up. The real source is `globalThis`; a test passes a plain object
 * instead to force the branch of a runtime the suite does not run in — a bundler's `process`
 * polyfill without `getBuiltinModule`, or an engine that ships `AsyncContext`.
 *
 * Every member is `unknown` below its name because a runtime, a polyfill or a fake can put
 * anything there; detection checks each one is a function before calling it.
 */
export interface CapabilitySource {
  readonly process?: { readonly getBuiltinModule?: unknown } | undefined;
  readonly AsyncContext?: { readonly Variable?: unknown } | undefined;
}

function globalCapabilitySource(): CapabilitySource {
  return globalThis as CapabilitySource;
}

/**
 * Resolves Node's `AsyncLocalStorage` through `process.getBuiltinModule("node:async_hooks")`, or
 * `undefined` where that is unavailable.
 *
 * The built-in is never imported statically: a `node:` specifier in `dist/` breaks every browser
 * bundler that resolves imports eagerly (ADR-0004). The check is that `getBuiltinModule` is a
 * function, not that `process` exists, because bundlers polyfill `process` without it. Nothing is
 * cached — each call reads `source` afresh, so a test can change the answer between calls.
 */
export function resolveAsyncLocalStorage(source: CapabilitySource = globalCapabilitySource()): AsyncLocalStorageConstructor | undefined {
  const runtime = source.process;
  const getBuiltinModule = runtime?.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return undefined;
  }

  const asyncHooks = getBuiltinModule.call(runtime, "node:async_hooks") as { readonly AsyncLocalStorage?: unknown } | undefined;
  const resolved = asyncHooks?.AsyncLocalStorage;
  return typeof resolved === "function" ? (resolved as AsyncLocalStorageConstructor) : undefined;
}

/**
 * Resolves the TC39 `AsyncContext.Variable` constructor from `source.AsyncContext`, or `undefined`
 * where the engine does not ship it. Nothing is cached — each call reads `source` afresh.
 */
export function resolveAsyncContextVariable(
  source: CapabilitySource = globalCapabilitySource(),
): AsyncContextVariableConstructor | undefined {
  const resolved = source.AsyncContext?.Variable;
  return typeof resolved === "function" ? (resolved as AsyncContextVariableConstructor) : undefined;
}
