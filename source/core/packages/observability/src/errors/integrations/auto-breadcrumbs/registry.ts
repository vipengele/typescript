/** A runtime global `autoBreadcrumbs` instruments, each with its own realm slot (ADR-0028). */
export type InstrumentationType = "console" | "fetch" | "xhr" | "navigation" | "clicks";

/**
 * Undoes what a patch did. A restore puts back only what still holds the patch's own wrapper or
 * listener: a property something else has re-wrapped since is left as it is, because restoring it
 * would remove the other party's wrapper, and the patch's wrapper then stays underneath it and
 * passes through inertly. The registry never inspects the global itself; the restore owns that
 * check, property by property ({@link patchProperties} implements it for method properties). The
 * registry calls a restore at most once and swallows anything it throws.
 */
export type Restore = () => void;

/**
 * Installs a type's instrumentation on the realm's globals. Returns the {@link Restore} that undoes
 * it, or `undefined` when nothing could be patched. `options` reads the oldest live install's
 * options while this patch is the type's current one, and `undefined` once it is not — after the
 * last install is torn down, even when the restore left the wrapper in place, and through any later
 * patch of the same type. A wrapper reads `options` on every call and records nothing when it gives
 * `undefined`, so a wrapper left in place never records alongside a later one.
 */
export type Patch<O> = (options: () => O | undefined) => Restore | undefined;

/**
 * One install in a type's install list. This shape, with `options` carrying the type's option
 * fields, is the contract every copy of the package agrees on (ADR-0028 item 4): an entry may come
 * from a different copy, so a reader defaults any option field it finds missing.
 */
export interface InstallEntry<O = unknown> {
  readonly options: O;
}

/** The patch currently on the realm's globals for a type. Its identity marks which patch is current. */
interface CurrentPatch {
  readonly restore: Restore;
}

/** A type's realm slot: the live installs, oldest first, and the patch they share. */
interface InstrumentationSlot {
  readonly installs: InstallEntry[];
  patch: CurrentPatch | undefined;
}

type SlotRegistry = Record<symbol, InstrumentationSlot | undefined>;

function slotFor(type: InstrumentationType): InstrumentationSlot {
  const key = Symbol.for(`vipengele:breadcrumbs:instrumentation:${type}:v1`);
  const registry = globalThis as unknown as SlotRegistry;
  let slot = registry[key];
  if (slot === undefined) {
    slot = { installs: [], patch: undefined };
    registry[key] = slot;
  }
  return slot;
}

/**
 * Joins `options` to the realm's install list for `type` and returns the function that leaves it.
 * The first install, while the list is empty, calls `patch`; a later one only appends. A `patch`
 * that returns `undefined` or throws joins nothing: the returned function does nothing and the next
 * install tries patching again. Leaving removes this install, handing over to the next oldest; the
 * last one to leave clears the slot's patch, so a later install patches afresh, and then calls its
 * {@link Restore}. Leaving twice is a no-op, and leaving never throws.
 */
export function install<O>(type: InstrumentationType, options: O, patch: Patch<O>): () => void {
  const slot = slotFor(type);
  if (slot.installs.length === 0) {
    let current: CurrentPatch | undefined;
    const readOptions = (): O | undefined => {
      const live = slotFor(type);
      return current !== undefined && live.patch === current ? (live.installs[0]?.options as O | undefined) : undefined;
    };
    let restore: Restore | undefined;
    try {
      restore = patch(readOptions);
    } catch {
      restore = undefined;
    }
    if (restore === undefined) {
      return () => {};
    }
    current = { restore };
    slot.patch = current;
  }
  const entry: InstallEntry<O> = { options };
  slot.installs.push(entry);
  return () => {
    const live = slotFor(type);
    const index = live.installs.indexOf(entry);
    if (index === -1) {
      return;
    }
    live.installs.splice(index, 1);
    if (live.installs.length > 0) {
      return;
    }
    const finished = live.patch;
    live.patch = undefined;
    try {
      finished?.restore();
    } catch {
      // A restore that throws leaves whatever it did not undo in place, inert: the slot no longer
      // names its patch, so its wrappers read no options.
    }
  };
}

/**
 * The options of the oldest live install of `type` in the realm, from whichever copy of the package
 * installed it, or `undefined` when none is live. Read at call time, so tearing the oldest install
 * down hands over to the next.
 */
export function activeOptions<O>(type: InstrumentationType): O | undefined {
  return slotFor(type).installs[0]?.options as O | undefined;
}

/**
 * Replaces each method `keys` names on `target` with `wrap(original, key)`, one assignment at a
 * time. A key whose value is not a function, whose read throws, or whose assignment throws or does
 * not take (a frozen or accessor property) is skipped. Returns `undefined` when no key was replaced,
 * otherwise a {@link Restore} that puts each replaced key's original back only while the key still
 * holds the wrapper put there, and never throws.
 */
export function patchProperties<T extends object>(
  target: T,
  keys: readonly string[],
  wrap: (original: (...args: never[]) => unknown, key: string) => (...args: never[]) => unknown,
): Restore | undefined {
  const properties = target as unknown as Record<string, unknown>;
  const undo: Restore[] = [];
  for (const key of keys) {
    try {
      const original = properties[key];
      if (typeof original !== "function") {
        continue;
      }
      const wrapper = wrap(original as (...args: never[]) => unknown, key);
      properties[key] = wrapper;
      if (properties[key] !== wrapper) {
        continue;
      }
      undo.push(() => {
        if (properties[key] === wrapper) {
          properties[key] = original;
        }
      });
    } catch {
      // This key stays unpatched; the others are still tried.
    }
  }
  if (undo.length === 0) {
    return undefined;
  }
  return () => {
    for (const restoreKey of undo) {
      try {
        restoreKey();
      } catch {
        // A key that can no longer be assigned keeps the wrapper, inert once the patch is not current.
      }
    }
  };
}
