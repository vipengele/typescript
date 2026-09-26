import { matchKey, type RedactionPolicy } from "./key-matcher";
import { applyReplacement, type Replacement } from "./replacement";

/** How a redaction pass rewrites the values it matches. */
export interface RedactOptions {
  /** What a matched value is replaced with. Defaults to the string `"[REDACTED]"`. */
  replacement?: Replacement;
}

const DEFAULT_REPLACEMENT = "[REDACTED]";

/** What a container is replaced with when it is reached again from inside itself. */
const CIRCULAR = "[Circular]";

interface WalkContext {
  readonly policy: RedactionPolicy;
  readonly replacement: Replacement;
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
 * instances are copied; `Date`s, `ArrayBuffer`s and their views, functions and primitives are
 * returned as-is. The input is never mutated.
 *
 * A class instance or `Error` comes back as a plain object carrying its own enumerable string
 * keys, so the result never depends on the class being constructible. A `Map` is only matched
 * under its string keys; a value under any other key is still walked.
 */
export function redact(value: unknown, policy: RedactionPolicy, options?: RedactOptions): unknown {
  return walk(value, { policy, replacement: options?.replacement ?? DEFAULT_REPLACEMENT, ancestors: new WeakSet() });
}

function walk(value: unknown, context: WalkContext): unknown {
  if (typeof value !== "object" || value === null || isOpaque(value)) return value;
  if (context.ancestors.has(value)) return CIRCULAR;
  context.ancestors.add(value);
  try {
    return walkContainer(value, context);
  } finally {
    context.ancestors.delete(value);
  }
}

/** `Object.prototype.toString`'s builtin tag, stable across realms unlike `instanceof`. */
function tagOf(value: object): string {
  return Object.prototype.toString.call(value);
}

/**
 * Objects returned by reference because they hold no keyed data a key rule could match, or their
 * state lives outside their own enumerable keys, so a generic walk would silently discard it and
 * return `{}` — a `RegExp`'s pattern, a boxed primitive's wrapped value, a `Promise`'s resolution.
 *
 * `URL` is deliberately excluded even though it has the same shape: it can carry credentials, in
 * userinfo (`https://user:pass@host`) or a query string, that a policy has no way to name, so it
 * falls to the generic walk instead and comes back `{}` rather than leaking them by reference.
 *
 * Checked by tag, not `instanceof`: an `instanceof` check fails for a value built in another
 * realm (an iframe's `Date`, say), which would otherwise fall through to the generic walk and
 * silently lose everything this function exists to preserve by reference.
 */
function isOpaque(value: object): boolean {
  if (ArrayBuffer.isView(value)) return true;
  switch (tagOf(value)) {
    case "[object Date]":
    case "[object ArrayBuffer]":
    case "[object RegExp]":
    case "[object Promise]":
    case "[object String]":
    case "[object Number]":
    case "[object Boolean]":
      return true;
    default:
      return false;
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function walkContainer(value: object, context: WalkContext): unknown {
  if (isPlainObject(value)) return walkFields(value, context);
  if (Array.isArray(value)) return value.map((element: unknown) => walk(element, context));
  switch (tagOf(value)) {
    case "[object Map]":
      return walkMap(value as Map<unknown, unknown>, context);
    case "[object Set]":
      return new Set([...(value as Set<unknown>)].map((member: unknown) => walk(member, context)));
    case "[object Error]":
      return walkError(value as Error, context);
    default:
      return walkFields(value, context);
  }
}

/**
 * `toJSON` is never copied: it would carry the original instance's closure into the redacted
 * copy, and `JSON.stringify` calls it automatically, running arbitrary code that still has
 * access to the un-redacted value and can write it straight into the "redacted" output.
 */
function walkFields(
  value: object,
  context: WalkContext,
  into: Record<string, unknown> = {},
  skip?: ReadonlySet<string>,
): Record<string, unknown> {
  for (const key of Object.keys(value)) {
    if (key === "toJSON" || skip?.has(key)) continue;
    setField(into, key, (value as Record<string, unknown>)[key], context);
  }
  return into;
}

function walkMap(value: Map<unknown, unknown>, context: WalkContext): Map<unknown, unknown> {
  const out = new Map<unknown, unknown>();
  for (const [key, entry] of value) {
    out.set(key, typeof key === "string" ? redactField(key, entry, context) : walk(entry, context));
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
 * function `Replacement` twice for the same value and keeping only the second result.
 */
function walkError(error: Error, context: WalkContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  setField(out, "name", error.name, context);
  setField(out, "message", error.message, context);
  setField(out, "stack", error.stack, context);
  if ("cause" in error) setField(out, "cause", error.cause, context);
  return walkFields(error, context, out, ERROR_OWN_FIELDS);
}

function redactField(key: string, value: unknown, context: WalkContext): unknown {
  return matchKey(context.policy, key) ? applyReplacement(context.replacement, value, key) : walk(value, context);
}

/**
 * Defines rather than assigns: assigning an own `__proto__` key, as `JSON.parse` produces, would
 * set the copy's prototype instead of copying the field.
 */
function setField(out: Record<string, unknown>, key: string, value: unknown, context: WalkContext): void {
  Object.defineProperty(out, key, { value: redactField(key, value, context), enumerable: true, writable: true, configurable: true });
}
