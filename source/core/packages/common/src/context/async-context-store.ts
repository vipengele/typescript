import type { CapabilitySource } from "./capabilities";
import { createAsyncContextCarrier } from "./carriers/async-context-carrier";
import { createNodeAsyncLocalStorageCarrier } from "./carriers/node-async-local-storage-carrier";
import { createSyncStackCarrier } from "./carriers/sync-stack-carrier";
import { type ContextCarrier, getOrCreateRegistryEntry } from "./global-registry";

export type { ContextCarrier } from "./global-registry";

/** A value carried through the call graph under one key, shared by every copy of the package in the realm. */
export interface AsyncContextStore<T> {
  /** The value installed by the innermost enclosing {@link AsyncContextStore.propagate}, or the default outside any. */
  current(): T;
  /**
   * Calls `fn` with `value` installed, and returns what `fn` returns. The enclosing value is back in
   * place once `fn` returns or throws.
   *
   * Whether `value` is still current after an `await` inside `fn` depends on the carrier: it is
   * under `AsyncLocalStorage` and `AsyncContext`, and it is not under the synchronous fallback.
   */
  propagate<R>(value: T, fn: () => R): R;
  /**
   * Captures the value current now and returns a function that calls `fn` with that value
   * installed. It reinstalls context across a boundary the carrier cannot follow on its own — an
   * event listener, a timer, a callback handed to someone else's code.
   */
  propagate<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  /**
   * Replaces the carrier for this store's key. The replacement is seen immediately by every store
   * created with the same key, in every copy of the package.
   */
  useCarrier(carrier: ContextCarrier<T>): void;
}

/**
 * The carrier a store's key starts with: `AsyncLocalStorage` where the runtime exposes it, then a
 * native `AsyncContext.Variable`, then the synchronous stack, which every runtime supports.
 * `source` defaults to `globalThis`.
 */
export function resolveDefaultCarrier<T extends {}>(defaultValue: T, source?: CapabilitySource): ContextCarrier<T> {
  return (
    createNodeAsyncLocalStorageCarrier(defaultValue, source) ??
    createAsyncContextCarrier(defaultValue, source) ??
    createSyncStackCarrier(defaultValue)
  );
}

/**
 * Creates a store for `key` whose value outside any {@link AsyncContextStore.propagate} is
 * `defaultValue`.
 *
 * The carrier lives in a `globalThis` slot for `key`, so every store created with the same key —
 * including one from a second resolved copy of this package — reads and writes the same context.
 * The first store for a key picks the carrier and its default; later stores for the key reuse
 * both. Each call reads the slot afresh, so a {@link AsyncContextStore.useCarrier} made through any
 * of them applies to all.
 *
 * `T` excludes `null` and `undefined`: under `AsyncLocalStorage` a nullish value is
 * indistinguishable from no value and reads back as the default.
 */
export function createAsyncContextStore<T extends {}>(key: string, defaultValue: T): AsyncContextStore<T> {
  const entry = getOrCreateRegistryEntry(key, () => resolveDefaultCarrier(defaultValue));

  function propagate<R>(value: T, fn: () => R): R;
  function propagate<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  function propagate<Args extends unknown[], R>(valueOrFn: T | ((...args: Args) => R), fn?: () => R): R | ((...args: Args) => R) {
    if (fn !== undefined) {
      return entry.get().run(valueOrFn as T, fn);
    }

    const captured = entry.get().current();
    const callback = valueOrFn as (...args: Args) => R;
    return (...args) => entry.get().run(captured, () => callback(...args));
  }

  return {
    current: () => entry.get().current(),
    propagate,
    useCarrier: (carrier) => entry.set(carrier),
  };
}
