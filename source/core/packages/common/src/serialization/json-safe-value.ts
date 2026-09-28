/**
 * A value that survives `JSON.stringify` unchanged and means the same thing on every sink: no
 * `undefined`, no class instances, no cycles. {@link toJsonSafe} brings any value into this shape.
 */
export type JsonSafeValue = string | number | boolean | null | readonly JsonSafeValue[] | { readonly [key: string]: JsonSafeValue };
