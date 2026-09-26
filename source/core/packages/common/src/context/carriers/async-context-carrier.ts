import { type CapabilitySource, resolveAsyncContextVariable } from "../capabilities";
import type { ContextCarrier } from "../global-registry";

/**
 * A carrier backed by a TC39 `AsyncContext.Variable`, the engine-native propagation the proposal
 * specifies. Returns `undefined` where the engine does not ship `AsyncContext`, leaving the caller
 * to fall back to another carrier.
 *
 * The variable owns the default, so `current()` outside any `run` is the variable's `get()`.
 */
export function createAsyncContextCarrier<T>(defaultValue: T, source?: CapabilitySource): ContextCarrier<T> | undefined {
  const Variable = resolveAsyncContextVariable(source);
  if (Variable === undefined) {
    return undefined;
  }

  const variable = new Variable<T>({ defaultValue });
  return {
    current: () => variable.get(),
    run: (value, fn) => variable.run(value, fn),
  };
}
