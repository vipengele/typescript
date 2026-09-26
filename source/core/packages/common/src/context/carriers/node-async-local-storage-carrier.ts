import { type CapabilitySource, resolveAsyncLocalStorage } from "../capabilities";
import type { ContextCarrier } from "../global-registry";

/**
 * A carrier backed by Node's `AsyncLocalStorage`, whose value follows every `await`, timer and
 * callback started inside {@link ContextCarrier.run}. Returns `undefined` where
 * `AsyncLocalStorage` is unavailable, leaving the caller to fall back to another carrier.
 *
 * `T` excludes `null` and `undefined` because `getStore()` answers `undefined` outside any `run`;
 * a nullish stored value would be indistinguishable from no value and read back as the default.
 */
export function createNodeAsyncLocalStorageCarrier<T extends NonNullable<unknown>>(
  defaultValue: T,
  source?: CapabilitySource,
): ContextCarrier<T> | undefined {
  const AsyncLocalStorage = resolveAsyncLocalStorage(source);
  if (AsyncLocalStorage === undefined) {
    return undefined;
  }

  const storage = new AsyncLocalStorage<T>();
  return {
    current: () => storage.getStore() ?? defaultValue,
    run: (value, fn) => storage.run(value, fn),
  };
}
