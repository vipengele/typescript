import type { Attributes } from "@vipengele/ts-core-common";

/** The value `normalizeAttributes` writes under its breadth key when it cuts a record. */
const TRUNCATION_MARKER = /^\[Truncated: \d+ more\]$/;

/** The first `<key>#<n>` that no layer holds and no earlier rename took. */
function freeKey(key: string, layers: readonly Attributes[], taken: ReadonlySet<string>): string {
  for (let suffix = 1; ; suffix++) {
    const candidate = `${key}#${suffix}`;
    if (!taken.has(candidate) && !layers.some((layer) => Object.hasOwn(layer, candidate))) {
      return candidate;
    }
  }
}

/**
 * Folds `layers`, least to most specific, into one record: a key a later layer holds wins over an
 * earlier layer's. Each layer is normalized on its own, so the breadth bound applies per layer and
 * a large lower layer cannot push a higher layer's attribute into the truncation marker. Every
 * layer names its marker by the same key, so a lower layer's marker that a higher layer's key would
 * shadow moves to a free `<key>#<n>` rather than being overwritten, and the record still shows that
 * the lower layer was cut. `Object.fromEntries` defines every key as an own data property, so a
 * `__proto__` key stays a key instead of replacing the result's prototype.
 */
export function mergeAttributes(layers: readonly Attributes[]): Attributes {
  const taken = new Set<string>();
  const entries = layers.flatMap((layer, index) => {
    const higher = layers.slice(index + 1);
    return Object.entries(layer).map(([key, value]): [string, Attributes[string]] => {
      if (typeof value !== "string" || !TRUNCATION_MARKER.test(value) || !higher.some((above) => Object.hasOwn(above, key))) {
        return [key, value];
      }
      const renamed = freeKey(key, layers, taken);
      taken.add(renamed);
      return [renamed, value];
    });
  });
  return Object.fromEntries(entries);
}
