/**
 * What every carrier implements, and what a registry slot holds: the value currently in context,
 * and a way to run a function with a different value in context.
 */
export interface ContextCarrier<T> {
  /** The value installed by the innermost enclosing {@link ContextCarrier.run}, or the carrier's default outside any. */
  current(): T;
  /** Calls `fn` with `value` installed, and returns what `fn` returns. */
  run<R>(value: T, fn: () => R): R;
}

/** A handle on one registry slot. Every handle for the same key reads and writes the same slot. */
export interface RegistryEntry<T> {
  get(): ContextCarrier<T>;
  set(carrier: ContextCarrier<T>): void;
}

type Registry = Record<symbol, unknown>;

/**
 * Returns a handle on the `globalThis` slot for `key`, filling it with `createDefault()` only when
 * the slot is empty.
 *
 * The slot is keyed by `Symbol.for`, which is shared across every module instance in a realm, so
 * two resolved copies of this package in one app — differing peer ranges are enough — agree on
 * one carrier per key instead of each propagating a context the other cannot see. The first
 * caller's carrier wins; a later caller's `createDefault` is never invoked. `set` replaces the
 * slot's carrier, visible through every handle for the key on its next `get`.
 */
export function getOrCreateRegistryEntry<T>(key: string, createDefault: () => ContextCarrier<T>): RegistryEntry<T> {
  const slot = Symbol.for(`vipengele:async-context-store:${key}`);
  const registry = globalThis as unknown as Registry;

  if (registry[slot] === undefined) {
    registry[slot] = createDefault();
  }

  return {
    get: () => registry[slot] as ContextCarrier<T>,
    set: (carrier) => {
      registry[slot] = carrier;
    },
  };
}
