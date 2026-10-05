import type { ContextCarrier } from "../context";
import {
  assertSettable,
  createChildScope,
  getScopeTree,
  type Resource,
  type Scope as ScopeHandle,
  type ScopeAttributes,
  setResource as setRootResource,
} from "./root";
import { getScopeStore } from "./store";

/** A node of the scope tree: its `tag`, and `get`/`set` for the attributes it and its ancestors hold. */
export type Scope = ScopeHandle;

/** The scope installed by the innermost enclosing propagation, or the realm's default scope outside any. */
function current(): Scope {
  return getScopeStore().current();
}

/**
 * Calls `fn` with `scope` current, and returns what `fn` returns. The enclosing scope is back in
 * place once `fn` returns or throws.
 */
function propagate<R>(scope: Scope, fn: () => R): R;
/**
 * Captures the scope current now and returns a function that calls `fn` with that scope current.
 * It reinstalls the scope across a boundary the carrier cannot follow on its own — an `await` under
 * the synchronous fallback, an event listener, a timer.
 */
function propagate<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
function propagate<Args extends unknown[], R>(scopeOrFn: Scope | ((...args: Args) => R), fn?: () => R): R | ((...args: Args) => R) {
  const store = getScopeStore();
  return fn === undefined ? store.propagate(scopeOrFn as (...args: Args) => R) : store.propagate(scopeOrFn as Scope, fn);
}

/**
 * Creates a child of the current scope carrying `tag` and `attributes`, and calls `fn` with it
 * current. Two calls made one after another in the same frame each get the same parent, since the
 * first child is no longer current once its `fn` returns.
 *
 * @throws {ReservedScopeKeyError} when `attributes` holds a key the root holds.
 */
function inherit<R>(tag: string, attributes: ScopeAttributes, fn: () => R): R {
  return getScopeStore().propagate(createChildScope(current(), tag, attributes), fn);
}

/**
 * Creates a child of the root carrying `tag` and `attributes`, whatever scope is current, and calls
 * `fn` with it current. It begins a Unit of Work: the new scope reads nothing any other Unit of
 * Work's scopes hold, only the root's Resource.
 *
 * @throws {ReservedScopeKeyError} when `attributes` holds a key the root holds.
 */
function isolated<R>(tag: string, attributes: ScopeAttributes, fn: () => R): R {
  return getScopeStore().propagate(createChildScope(getScopeTree().root, tag, attributes), fn);
}

/**
 * The Resource the root scope holds, read from the realm's one root whatever scope is current. It
 * is frozen: the logger hands one Resource to every sink for a record, so a sink writing to it
 * would otherwise change what the sinks after it see.
 */
function resource(): Resource {
  const { root } = getScopeTree();
  return Object.freeze({
    "service.name": root.get("service.name") as string | undefined,
    "service.version": root.get("service.version") as string | undefined,
    "deployment.environment.name": root.get("deployment.environment.name") as string | undefined,
    "process.runtime.name": root.get("process.runtime.name") as string | undefined,
  });
}

/**
 * Merges `resource` into the Resource the realm's one root holds, from whichever copy of the
 * package calls it. A key whose value is `undefined` or not a string is skipped — never cleared,
 * never coerced — and a key outside the four is ignored. Every scope already in flight, and every
 * Logger and Reporter already built, reads the merged values from then on; a Resource
 * {@link resource} returned earlier keeps the values it was read with. It never throws.
 */
function setResource(resource: Partial<Resource>): void {
  setRootResource(getScopeTree().root, resource);
}

/** Writes every `[key, value]` pair to the current scope, validating all keys before writing any. */
function writeAll(entries: readonly (readonly [string, unknown])[]): void {
  const scope = current();
  for (const [key] of entries) {
    assertSettable(scope, key);
  }
  for (const [key, value] of entries) {
    scope.set(key, value);
  }
}

/** The user attributes {@link setUser} writes. */
export interface ScopeUser {
  readonly id?: string | undefined;
  readonly email?: string | undefined;
  readonly username?: string | undefined;
}

/**
 * Sets `user.id`, `user.email` and `user.username` on the current scope, from the fields of `user`
 * that are not `undefined`. Descendants see them; the ancestors do not.
 *
 * Every key is validated before any is written, so a refusal leaves the scope as it was.
 *
 * @throws {ReservedScopeKeyError} when a key is one the root holds.
 */
function setUser(user: ScopeUser): void {
  const entries: [string, unknown][] = [];
  if (user.id !== undefined) {
    entries.push(["user.id", user.id]);
  }
  if (user.email !== undefined) {
    entries.push(["user.email", user.email]);
  }
  if (user.username !== undefined) {
    entries.push(["user.username", user.username]);
  }
  writeAll(entries);
}

/**
 * Sets the attribute `key` to `value` on the current scope. Descendants see it; the ancestors do not.
 *
 * Reporter redaction splits keys on every non-alphanumeric character, so a tag such as
 * `sessionId` or `token` is masked by the default `secretKeys`.
 *
 * @throws {ReservedScopeKeyError} when `key` is one the root holds.
 */
function setTag(key: string, value: unknown): void {
  writeAll([[key, value]]);
}

/**
 * Sets one attribute per own field of `data` on the current scope, keyed `name.field` with `field`
 * taken verbatim; a nested value stays a value. Descendants see them; the ancestors do not.
 *
 * Every key is validated before any is written, so a refusal leaves the scope as it was.
 *
 * Reporter redaction splits keys on every non-alphanumeric character, so `session.id` carries the
 * word `id` of a `session` and a context named `token` is masked by the default `secretKeys`.
 *
 * @throws {TypeError} when `name` is not a non-empty string.
 * @throws {ReservedScopeKeyError} when a key is one the root holds.
 */
function setContext(name: string, data: Readonly<Record<string, unknown>>): void {
  if (typeof name !== "string" || name === "") {
    throw new TypeError("Scope.setContext requires `name` to be a non-empty string.");
  }
  writeAll(Object.entries(data).map(([field, value]) => [`${name}.${field}`, value] as const));
}

/**
 * Replaces the carrier the current scope rides on — a zone.js-backed carrier in an application that
 * already runs under zone.js, say. The replacement is seen immediately by every copy of the package
 * in the realm, and applies to every propagation made from then on.
 */
function useCarrier(carrier: ContextCarrier<Scope>): void {
  getScopeStore().useCarrier(carrier);
}

/**
 * The realm's one scope tree, as an application reaches it. Every scope is entered through a
 * callback, so the scope current once that callback returns is always the one that was current
 * before it was called.
 */
export const Scope = {
  current,
  propagate,
  inherit,
  isolated,
  resource,
  setResource,
  setUser,
  setTag,
  setContext,
  useCarrier,
} as const;
