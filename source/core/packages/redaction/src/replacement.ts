/**
 * What a redaction replaces a matched value with: a fixed string, or a function computing the
 * replacement from the original `value` and the key it was found under. Narrowed to
 * `string | (...)` rather than `unknown | (...)` — the latter collapses to `unknown` in TS and
 * documents nothing about the string case.
 */
export type Replacement = string | ((value: unknown, key: string) => unknown);

/**
 * Resolves a `Replacement` for one matched value. A string replacement is returned as-is; a
 * function replacement is always invoked with `(value, key)` and its return value is returned.
 */
export function applyReplacement(replacement: Replacement, value: unknown, key: string): unknown {
  return typeof replacement === "string" ? replacement : replacement(value, key);
}
