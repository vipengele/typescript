/**
 * A value that survives `JSON.stringify` unchanged and means the same thing on every sink: no
 * `undefined`, no class instances, no cycles. Anything a caller hands over is brought into this
 * shape by {@link normalizeAttributes} before a sink or transport sees it.
 */
export type AttributeValue = string | number | boolean | null | readonly AttributeValue[] | { readonly [key: string]: AttributeValue };

/** A normalized attribute record: every value is an {@link AttributeValue}. */
export type Attributes = Readonly<Record<string, AttributeValue>>;

/**
 * What a caller may pass as attributes. Values are `unknown` because the caller's data is
 * arbitrary — a `Date`, a `Map`, an `Error`, an object with throwing getters — and it is the
 * normalizer's job, not the caller's, to make it safe.
 */
export type AttributesInput = Readonly<Record<string, unknown>>;
