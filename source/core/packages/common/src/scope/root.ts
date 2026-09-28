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
    current = current[PARENT];
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
    for (let node: ScopeNode | undefined = this; node !== undefined; node = node[PARENT]) {
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
