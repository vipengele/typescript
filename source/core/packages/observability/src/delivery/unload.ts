/**
 * The keepalive budget, in bytes of request body: browsers refuse a `keepalive` fetch once the
 * bodies of every keepalive request still in flight from one document add up to more than 64 KiB.
 */
export const UNLOAD_BUDGET_BYTES = 65_536;

/** The part of an `EventTarget` the unload watch uses. */
export interface LifecycleTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** A `Document`-like target: `visibilitychange` counts only once `visibilityState` reads `"hidden"`. */
export interface VisibilityTarget extends LifecycleTarget {
  readonly visibilityState?: string;
}

/** Where the page's lifecycle events arrive; a missing target is not watched. */
export interface LifecycleTargets {
  /** Fires `pagehide`; a `Window` is one. */
  readonly window?: LifecycleTarget | undefined;
  /** Fires `visibilitychange`; a `Document` is one. */
  readonly document?: VisibilityTarget | undefined;
}

function isTarget(value: unknown): value is LifecycleTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<LifecycleTarget>).addEventListener === "function" &&
    typeof (value as Partial<LifecycleTarget>).removeEventListener === "function"
  );
}

/**
 * Finds the lifecycle targets `scope` offers: `scope` itself as the window when it is an event
 * target with an `onpagehide` handler slot (a `Window`, not a worker scope or a server runtime's
 * global), and `scope.document` when that is an event target. Either is left out when absent.
 */
export function detectLifecycleTargets(scope: object = globalThis): LifecycleTargets {
  const document = (scope as { document?: unknown }).document;
  return {
    window: isTarget(scope) && "onpagehide" in scope ? scope : undefined,
    document: isTarget(document) ? (document as VisibilityTarget) : undefined,
  };
}

/**
 * Calls `onUnload` on `pagehide` at `targets.window` and on a `visibilitychange` at
 * `targets.document` that leaves it `"hidden"`. Both usually fire as a page goes away, the
 * visibility change first, so `onUnload` must find nothing left to do on the second call.
 * Returns the function that removes both listeners.
 */
export function watchUnload(targets: LifecycleTargets, onUnload: () => void): () => void {
  const removers: (() => void)[] = [];
  const { window, document } = targets;
  if (window !== undefined) {
    const onPageHide = (): void => {
      onUnload();
    };
    window.addEventListener("pagehide", onPageHide);
    removers.push(() => window.removeEventListener("pagehide", onPageHide));
  }
  if (document !== undefined) {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        onUnload();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    removers.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
  }
  return () => {
    for (const remove of removers.splice(0)) {
      remove();
    }
  };
}

/** The UTF-8 length of `text`, the size it has as a request body. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The oldest entries that fit the budget, and their encoding; `count` 0 carries an empty body. */
export interface FittingPrefix {
  readonly count: number;
  readonly body: string;
}

/**
 * The largest prefix of `entries` whose encoding is at most `maxBytes` UTF-8 bytes. Tries every
 * entry first, then halves the count until a prefix fits, then bisects between that count and the
 * last one that did not fit. Assumes a longer prefix never encodes smaller; a throw from `encode`
 * propagates.
 */
export function largestFittingPrefix<E>(
  entries: ReadonlyArray<E>,
  encode: (entries: ReadonlyArray<E>) => string,
  maxBytes: number,
): FittingPrefix {
  const tryCount = (count: number): string | undefined => {
    const body = encode(entries.slice(0, count));
    return utf8ByteLength(body) <= maxBytes ? body : undefined;
  };
  let tooBig = entries.length + 1;
  let fit: FittingPrefix = { count: 0, body: "" };
  for (let count = entries.length; count > 0; count = Math.floor(count / 2)) {
    const body = tryCount(count);
    if (body !== undefined) {
      fit = { count, body };
      break;
    }
    tooBig = count;
  }
  if (fit.count === 0) {
    return fit;
  }
  while (tooBig - fit.count > 1) {
    const count = Math.floor((fit.count + tooBig) / 2);
    const body = tryCount(count);
    if (body === undefined) {
      tooBig = count;
    } else {
      fit = { count, body };
    }
  }
  return fit;
}
