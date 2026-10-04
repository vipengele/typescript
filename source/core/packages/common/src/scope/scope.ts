import type { ContextCarrier } from "../context";
import { createChildScope, getScopeTree, type Resource, type Scope as ScopeHandle, type ScopeAttributes } from "./root";
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

/** The Resource the root scope holds, read from the realm's one root whatever scope is current. */
function resource(): Resource {
  const { root } = getScopeTree();
  return {
    "service.name": root.get("service.name") as string | undefined,
    "service.version": root.get("service.version") as string | undefined,
    "deployment.environment.name": root.get("deployment.environment.name") as string | undefined,
    "process.runtime.name": root.get("process.runtime.name") as string | undefined,
  };
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
  useCarrier,
} as const;
