import { matchKey, type RedactionPolicy } from "./key-matcher";
import {
  breadthMarker,
  breadthMarkerKey,
  exceedsBreadth,
  keepWithinBreadth,
  type Limits,
  resolveLimits,
  TRUNCATED,
  truncateString,
} from "./limits";
import { applyReplacement, type Replacement } from "./replacement";

/**
 * How a redaction pass rewrites the values it matches, and how far it walks. A limit only ever
 * drops data: a value under a matched key is replaced even when it lies past `maxDepth`, and a
 * container past `maxDepth` is never read at all. No limit is validated — `NaN` disables it, and
 * `Infinity` turns it off on purpose.
 */
export interface RedactOptions {
  /** What a matched value is replaced with. Defaults to the string `"[REDACTED]"`. */
  replacement?: Replacement;
  /**
   * Levels of nesting kept, the input itself counting as the first; only containers count. A
   * container deeper than this is replaced whole by `"[Truncated]"`. Defaults to 6. `Infinity`
   * walks any depth, at the risk of overflowing the stack on a deep enough input.
   */
  maxDepth?: number;
  /**
   * Fields kept per object, items per array, entries per `Map`, members per `Set` and own
   * enumerable fields per `Error` (its `name`, `message`, `stack` and `cause` are always kept);
   * the rest are summarised by one `"[Truncated: N more]"` marker — an extra item or member, or a
   * field under the key `"…"` (`"…#1"`, `"…#2"`… when a kept key already holds it). Defaults to 100.
   */
  maxBreadth?: number;
  /**
   * UTF-16 code units kept per string value before it is cut and suffixed with `"…[truncated]"`.
   * Keys are never cut. Defaults to 8192.
   */
  maxStringLength?: number;
}

const DEFAULT_REPLACEMENT = "[REDACTED]";

/** What a container is replaced with when it is reached again from inside itself. */
const CIRCULAR = "[Circular]";

interface WalkContext {
  readonly policy: RedactionPolicy;
  readonly replacement: Replacement;
  readonly limits: Limits;
  /**
   * The containers on the current recursion path, not every container ever visited. A container
   * reachable from two sibling branches is walked, and redacted, once per branch; only a container
   * that is still its own ancestor is a cycle.
   */
  readonly ancestors: WeakSet<object>;
}

/**
 * Returns a redacted copy of `value`: every value found under a key the policy matches is replaced
 * whole, and never descended into. Plain objects, arrays, `Map`s, `Set`s, `Error`s and other class
 * instances are copied; `Date`s, `RegExp`s, boxed primitives, `ArrayBuffer`s and their views,
 * functions and primitives are returned as-is. The input is never mutated.
 *
 * A class instance or `Error` comes back as a plain object carrying its own enumerable string
 * keys, so the result never depends on the class being constructible. A `Map` is only matched
 * under its string keys; a value under any other key is still walked.
 *
 * The walk is bounded by the depth, breadth and string length limits in {@link RedactOptions},
 * each on by default; a breach leaves a marker in the copy rather than throwing.
 */
export function redact(value: unknown, policy: RedactionPolicy, options?: RedactOptions): unknown {
  return walk(
    value,
    { policy, replacement: options?.replacement ?? DEFAULT_REPLACEMENT, limits: resolveLimits(options), ancestors: new WeakSet() },
    1,
  );
}

/**
 * `depth` is the level `value` sits at, the root being 1. The cycle check runs ahead of the depth
 * check, so a reference back to an ancestor reads as `"[Circular]"` even at the depth limit.
 */
function walk(value: unknown, context: WalkContext, depth: number): unknown {
  if (typeof value === "string") return truncateString(value, context.limits);
  if (typeof value !== "object" || value === null || isOpaque(value)) return value;
  if (context.ancestors.has(value)) return CIRCULAR;
  if (depth > context.limits.maxDepth) return TRUNCATED;
  context.ancestors.add(value);
  try {
    return walkContainer(value, context, depth + 1);
  } finally {
    context.ancestors.delete(value);
  }
}

/**
 * Whether `value` genuinely has the internal slot a real instance of the built-in owning
 * `method` would have, by calling `method` and seeing whether it throws. `method` must be one the
 * spec requires to `RequireInternalSlot` before doing anything else, so it throws for anything
 * else — including a plain object whose own `Symbol.toStringTag` merely claims to be that
 * built-in. Unlike a tag or `Object.prototype.toString` check, this cannot be spoofed by a
 * property the value's own author controls, and unlike `instanceof`, it still recognizes a
 * genuine instance built in another realm, whose internal slot exists independently of which
 * realm's constructor and prototype it came from.
 */
function hasBrand(method: (this: unknown) => unknown): (value: object) => boolean {
  return (value) => {
    try {
      method.call(value);
      return true;
    } catch {
      return false;
    }
  };
}

const isDate = hasBrand(Date.prototype.getTime);
const isArrayBufferInstance = hasBrand(
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get as (this: unknown) => unknown,
);
const isRegExpInstance = hasBrand(Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get as (this: unknown) => unknown);
const isMapInstance = hasBrand(Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get as (this: unknown) => unknown);
const isSetInstance = hasBrand(Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get as (this: unknown) => unknown);
const isBoxedString = hasBrand(String.prototype.valueOf);
const isBoxedNumber = hasBrand(Number.prototype.valueOf);
const isBoxedBoolean = hasBrand(Boolean.prototype.valueOf);

/**
 * Objects returned by reference because they hold no keyed data a key rule could match, or their
 * state lives outside their own enumerable keys, so a generic walk would silently discard it and
 * return `{}` — a `RegExp`'s pattern, a boxed primitive's wrapped value.
 *
 * `URL` and `Promise` are deliberately excluded even though they have the same shape: `URL` can
 * carry credentials, in userinfo (`https://user:pass@host`) or a query string, that a policy has
 * no way to name; a genuine `Promise` has no brand check with no side effects (every method that
 * would prove it requires calling `.then`, which attaches a handler to the real promise). Both
 * fall to the generic walk instead and come back `{}` rather than risk leaking or mutating them.
 */
function isOpaque(value: object): boolean {
  return (
    isDate(value) ||
    isArrayBufferInstance(value) ||
    ArrayBuffer.isView(value) ||
    isRegExpInstance(value) ||
    isBoxedString(value) ||
    isBoxedNumber(value) ||
    isBoxedBoolean(value)
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * `Error` has no brand check: every method on `Error.prototype`, including `toString`, is
 * specified to work by duck-typing (reading `name`/`message`), never by requiring an internal
 * slot, so there is nothing to call that throws for an impostor. That is safe here regardless: a
 * plain object whose own `Symbol.toStringTag` merely claims to be an `Error` still only has
 * `walkError` read its own enumerable fields, the same as any other class instance would — there
 * is no data it can expose that a normal instance walk would not, and nothing here can throw on
 * it either.
 */
function isErrorTagged(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Error]";
}

/** `depth` is the level the container's own entries sit at, one below the container itself. */
function walkContainer(value: object, context: WalkContext, depth: number): unknown {
  if (isPlainObject(value)) return walkFields(value, context, depth);
  if (Array.isArray(value)) return walkItems(value, context, depth);
  if (isMapInstance(value)) return walkMap(value as Map<unknown, unknown>, context, depth);
  if (isSetInstance(value)) return new Set(walkItems([...(value as Set<unknown>)], context, depth));
  if (isErrorTagged(value)) return walkError(value as Error, context, depth);
  return walkFields(value, context, depth);
}

/** Copies an array's or a `Set`'s first `maxBreadth` items, then a marker item for the rest. */
function walkItems(items: readonly unknown[], context: WalkContext, depth: number): unknown[] {
  const out = keepWithinBreadth(items, context.limits).map((item: unknown) => walk(item, context, depth));
  if (exceedsBreadth(items.length, context.limits)) out.push(breadthMarker(items.length, context.limits));
  return out;
}

/**
 * `toJSON` is never copied: it would carry the original instance's closure into the redacted
 * copy, and `JSON.stringify` calls it automatically, running arbitrary code that still has
 * access to the un-redacted value and can write it straight into the "redacted" output. Neither
 * it nor a `skip`ped key counts toward `maxBreadth`. The breadth marker's key is chosen against
 * every key already in `into`, including ones the caller put there before the walk.
 */
function walkFields(
  value: object,
  context: WalkContext,
  depth: number,
  into: Record<string, unknown> = {},
  skip?: ReadonlySet<string>,
): Record<string, unknown> {
  const keys = Object.keys(value).filter((key) => key !== "toJSON" && !skip?.has(key));
  for (const key of keepWithinBreadth(keys, context.limits)) {
    setField(into, key, (value as Record<string, unknown>)[key], context, depth);
  }
  if (exceedsBreadth(keys.length, context.limits)) {
    defineField(into, breadthMarkerKey(new Set(Object.keys(into))), breadthMarker(keys.length, context.limits));
  }
  return into;
}

/** Keys are kept as they are; the breadth marker's key is chosen against the kept string keys. */
function walkMap(value: Map<unknown, unknown>, context: WalkContext, depth: number): Map<unknown, unknown> {
  const out = new Map<unknown, unknown>();
  for (const [key, entry] of keepWithinBreadth([...value], context.limits)) {
    out.set(key, typeof key === "string" ? redactField(key, entry, context, depth) : walk(entry, context, depth));
  }
  if (exceedsBreadth(value.size, context.limits)) {
    const used = new Set([...out.keys()].filter((key): key is string => typeof key === "string"));
    out.set(breadthMarkerKey(used), breadthMarker(value.size, context.limits));
  }
  return out;
}

const ERROR_OWN_FIELDS = new Set(["name", "message", "stack", "cause"]);

/**
 * `name`, `message`, `stack` and `cause` are non-enumerable on an `Error`, so a walk over its own
 * enumerable keys alone returns an empty object and drops everything that describes the failure.
 * They are copied explicitly, then the enumerable walk picks up the fields a subclass adds. `cause`
 * set by plain assignment (rather than the constructor option) is enumerable, so the enumerable
 * walk skips these four names — otherwise a matched one would be redacted a second time, calling a
 * function `Replacement` twice for the same value and keeping only the second result. The four
 * are always kept; only the fields the enumerable walk adds count toward `maxBreadth`.
 */
function walkError(error: Error, context: WalkContext, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  setField(out, "name", error.name, context, depth);
  setField(out, "message", error.message, context, depth);
  setField(out, "stack", error.stack, context, depth);
  if ("cause" in error) setField(out, "cause", error.cause, context, depth);
  return walkFields(error, context, depth, out, ERROR_OWN_FIELDS);
}

/**
 * The key is matched before the value is walked, so a matched value is replaced even when it is a
 * container past `maxDepth`.
 */
function redactField(key: string, value: unknown, context: WalkContext, depth: number): unknown {
  return matchKey(context.policy, key) ? applyReplacement(context.replacement, value, key) : walk(value, context, depth);
}

function setField(out: Record<string, unknown>, key: string, value: unknown, context: WalkContext, depth: number): void {
  defineField(out, key, redactField(key, value, context, depth));
}

/**
 * Defines rather than assigns: assigning an own `__proto__` key, as `JSON.parse` produces, would
 * set the copy's prototype instead of copying the field.
 */
function defineField(out: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}
