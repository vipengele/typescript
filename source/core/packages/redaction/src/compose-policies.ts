import type { KeyMatcher, RedactionPolicy } from "./key-matcher";

/**
 * Combines policies into one: the result's `keys` are every part's `keys` and its `except` is
 * every part's `except`, each in order. `except` is policy-wide, so an exemption from one part
 * also exempts a key another part matches. The result and its arrays are frozen, and the parts
 * are never mutated or retained.
 *
 * The result is a new object on every call, and a policy is normalized once per object, so compose
 * once at startup and reuse the result; composing per call re-normalizes every matcher every time.
 */
export function composePolicies(...parts: RedactionPolicy[]): RedactionPolicy {
  const keys: KeyMatcher[] = [];
  const except: KeyMatcher[] = [];
  for (const part of parts) {
    keys.push(...part.keys);
    except.push(...(part.except ?? []));
  }
  return Object.freeze({ keys: Object.freeze(keys), except: Object.freeze(except) });
}
