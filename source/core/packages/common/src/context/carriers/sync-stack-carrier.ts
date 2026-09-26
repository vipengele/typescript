import type { ContextCarrier } from "../global-registry";

/**
 * A carrier that needs no runtime support: {@link ContextCarrier.run} pushes the value, calls
 * `fn`, and pops in a `finally`.
 *
 * The pop happens when `fn`'s synchronous frame returns or throws, not when a promise it returns
 * settles. Code after the first `await` inside an async `fn` therefore resumes with the value gone
 * — it sees whatever is on the stack when the microtask runs, usually the default. The value is
 * reliable only for the synchronous part of `fn`.
 */
export function createSyncStackCarrier<T>(defaultValue: T): ContextCarrier<T> {
  const stack: T[] = [];

  return {
    current: () => (stack.length === 0 ? defaultValue : (stack[stack.length - 1] as T)),
    run: (value, fn) => {
      stack.push(value);
      try {
        return fn();
      } finally {
        stack.pop();
      }
    },
  };
}
