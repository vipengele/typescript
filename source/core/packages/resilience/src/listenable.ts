import type { Listenable } from "./types";

export interface Emitter<E> {
  readonly listenable: Listenable<E>;
  emit(event: E): void;
}

/**
 * Each `on` call is its own subscription, so registering one function twice calls it twice per
 * event and each `Unsubscribe` removes only its own registration. `emit` walks a snapshot: a
 * listener added during an emit misses that event, and one removed during an emit still receives
 * it. A throwing listener is swallowed, as there is no logger to route it to, and never stops the
 * listeners after it.
 */
export function createEmitter<E>(): Emitter<E> {
  let subscriptions: ReadonlyArray<{ readonly listener: (event: E) => void }> = [];

  return {
    listenable: {
      on(listener) {
        const subscription = { listener };
        subscriptions = [...subscriptions, subscription];
        return () => {
          subscriptions = subscriptions.filter((s) => s !== subscription);
        };
      },
    },
    emit(event) {
      for (const { listener } of subscriptions) {
        try {
          listener(event);
        } catch {
          // A listener's failure must not reach the emitting policy or its sibling listeners.
        }
      }
    },
  };
}
