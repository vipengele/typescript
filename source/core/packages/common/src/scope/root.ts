import { VipengeleError } from "../errors/vipengele-error";

/** The attributes a scope holds of its own. */
export type ScopeAttributes = Record<string, unknown>;

/**
 * The environment the root scope holds: which service, release, environment and runtime is
 * emitting. Every key is reserved from the moment the root exists, whether or not it has a value.
 */
export interface Resource {
  readonly "service.name": string | undefined;
  readonly "service.version": string | undefined;
  readonly "deployment.environment.name": string | undefined;
  readonly "process.runtime.name": string | undefined;
}

/** A node of the scope tree, as the rest of the framework and an application see it. */
export interface Scope {
  /** The scope's Breadcrumb: a short label for the step it represents. The root and the default scope carry none. */
  readonly tag: string | undefined;
  /** The value of `key` on this scope or its nearest ancestor holding it, read at call time; `undefined` when none does. */
  get(key: string): unknown;
  /**
   * Sets `key` on this scope only; its descendants see the value, its ancestors do not.
   *
   * @throws {ReservedScopeKeyError} when `key` is held by the root, or when this scope is the root.
   */
  set(key: string, value: unknown): void;
}

/** The root scope and the default scope beneath it — one pair per realm. */
export interface ScopeTree {
  readonly root: Scope;
  readonly defaultScope: Scope;
}

/** The `code` every {@link ReservedScopeKeyError} carries, and the only thing {@link isReservedScopeKeyError} matches on. */
const RESERVED_SCOPE_KEY_ERROR_CODE = "common.scope.reserved-key";

/** Raised when a `set` targets the root scope, or a key the root scope holds. */
export class ReservedScopeKeyError extends VipengeleError {
  readonly code = RESERVED_SCOPE_KEY_ERROR_CODE;
}

/**
 * Narrows `value` to a {@link ReservedScopeKeyError}.
 *
 * The check is the `code` string, not `instanceof ReservedScopeKeyError`: two resolved copies of
 * this package give the same source two distinct class identities, so an identity check fails
 * against an error raised by the other copy.
 */
export function isReservedScopeKeyError(value: unknown): value is ReservedScopeKeyError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === RESERVED_SCOPE_KEY_ERROR_CODE;
}

// Ancestry and own attributes live under `Symbol.for` keys rather than `#private` fields: the tree
// is shared by every copy of the package in the realm, and one copy's code walks nodes another copy
// created, which a `#private` field would reject with a TypeError. Neither key is part of `Scope`.
const PARENT: unique symbol = Symbol.for("vipengele:scope:parent");
const ATTRIBUTES: unique symbol = Symbol.for("vipengele:scope:attributes");
const TREE = Symbol.for("vipengele:scope:tree");

interface ScopeNode extends Scope {
  readonly [PARENT]: ScopeNode | undefined;
  readonly [ATTRIBUTES]: ScopeAttributes;
}

/**
 * The resource the realm's root is built from until something supplies the real one. Its keys are
 * still reserved: reservation follows the key, not its value.
 */
const UNKNOWN_RESOURCE: Resource = {
  "service.name": undefined,
  "service.version": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
};

function rootOf(node: ScopeNode): ScopeNode {
  let current = node;
  while (current[PARENT] !== undefined) {
    // Walks the private, Symbol-keyed ancestry link, never a dynamic attribute key — nothing here
    // reads or writes the attribute bag, which is the thing that would need to be prototype-safe.
    current = current[PARENT]; // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
  }
  return current;
}

class TreeScope implements ScopeNode {
  readonly tag: string | undefined;
  readonly [PARENT]: ScopeNode | undefined;
  // A prototype-less bag, so a key like `__proto__` is stored as an attribute rather than
  // replacing the bag's prototype, and `Object.hasOwn` is the whole existence check.
  readonly [ATTRIBUTES]: ScopeAttributes = Object.create(null) as ScopeAttributes;

  constructor(parent: ScopeNode | undefined, tag: string | undefined) {
    this[PARENT] = parent;
    this.tag = tag;
  }

  get(key: string): unknown {
    // The bag each iteration reads is `Object.create(null)` (see [ATTRIBUTES] above), so it has no
    // prototype to reach — `Object.hasOwn` plus a bracket read on a prototype-less object can never
    // touch or expose `Object.prototype`, whatever `key` is.
    // biome-ignore format: the nosemgrep directive must stay on this line, not wrap to its own
    for (let node: ScopeNode | undefined = this; node !== undefined; node = node[PARENT]) { // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      if (Object.hasOwn(node[ATTRIBUTES], key)) {
        return node[ATTRIBUTES][key];
      }
    }
    return undefined;
  }

  set(key: string, value: unknown): void {
    const root = rootOf(this);
    if (root === this) {
      throw new ReservedScopeKeyError(`Cannot set "${key}" on the root scope, which never changes once built.`);
    }
    if (Object.hasOwn(root[ATTRIBUTES], key)) {
      throw new ReservedScopeKeyError(`Cannot set "${key}": the root scope holds it, and no other scope may.`);
    }
    this[ATTRIBUTES][key] = value;
  }
}

/**
 * Builds a root holding exactly `resource`'s four keys, and a default scope beneath it. The root's
 * attributes are frozen once built; the default scope is mutable like any other non-root scope.
 */
export function createScopeTree(resource: Resource): ScopeTree {
  const root = new TreeScope(undefined, undefined);
  const attributes = root[ATTRIBUTES];
  attributes["service.name"] = resource["service.name"];
  attributes["service.version"] = resource["service.version"];
  attributes["deployment.environment.name"] = resource["deployment.environment.name"];
  attributes["process.runtime.name"] = resource["process.runtime.name"];
  Object.freeze(attributes);

  return { root, defaultScope: new TreeScope(root, undefined) };
}

/**
 * Creates a child of `parent` carrying `tag` and its own copy of `attributes`. Each attribute goes
 * through {@link Scope.set}, so one the root holds is refused here exactly as it would be later.
 *
 * @throws {ReservedScopeKeyError} when `attributes` holds a key the root holds.
 */
export function createChildScope(parent: Scope, tag: string, attributes: ScopeAttributes): Scope {
  const child = new TreeScope(parent as ScopeNode, tag);
  for (const [key, value] of Object.entries(attributes)) {
    child.set(key, value);
  }
  return child;
}

/**
 * Flattens the attributes `scope` and each of its non-root ancestors hold into one prototype-less
 * record, the innermost holder of a key winning. A key set to `undefined` shadows an outer value
 * exactly as {@link Scope.get} does, so it appears with `undefined` rather than the outer value.
 *
 * The root is never copied: its Resource is sent once rather than copied into every event, and a
 * key the root holds is left out even if a non-root node somehow holds it too. The walk reads the
 * `Symbol.for`-keyed ancestry and attribute slots, so a scope created by another copy of the
 * package flattens the same way. It never throws: a value that is not a scope node yields an empty
 * record, and a node whose slots fail to read ends the walk with what was gathered so far.
 *
 * Framework-internal, not for application use.
 */
export function snapshot(scope: Scope): ScopeAttributes {
  const result = Object.create(null) as ScopeAttributes;
  const chain: ScopeAttributes[] = [];
  let root: ScopeAttributes | undefined;
  try {
    // Every bag read here is either prototype-less (see [ATTRIBUTES] above) or guarded by
    // `Object.hasOwn`, and `result` is prototype-less, so no key can reach `Object.prototype`.
    // biome-ignore format: the nosemgrep directive must stay on this line, not wrap to its own
    for (let node = scope as ScopeNode | undefined; typeof node === "object" && node !== null; node = node[PARENT]) { // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      const attributes = node[ATTRIBUTES];
      if (typeof attributes !== "object" || attributes === null) {
        break;
      }
      if (node[PARENT] === undefined) {
        root = attributes;
        break;
      }
      chain.push(attributes);
    }
  } catch {
    // A slot that throws on read ends the walk; `chain` keeps the nodes read before it.
  }

  try {
    for (const attributes of chain) {
      for (const key of Object.keys(attributes)) {
        if (Object.hasOwn(result, key) || (root !== undefined && Object.hasOwn(root, key))) {
          continue;
        }
        result[key] = attributes[key];
      }
    }
  } catch {
    // An attribute that throws on read leaves the record with the keys copied before it.
  }
  return result;
}

/**
 * The realm's scope tree. It lives in a `globalThis` slot keyed by `Symbol.for`, so every copy of
 * the package in the realm hangs its scopes off the same root: the first caller builds the tree,
 * and every later caller — from any copy — gets that one.
 */
export function getScopeTree(): ScopeTree {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  if (registry[TREE] === undefined) {
    registry[TREE] = createScopeTree(UNKNOWN_RESOURCE);
  }
  return registry[TREE] as ScopeTree;
}
