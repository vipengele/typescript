import { type AsyncContextStore, createAsyncContextStore } from "../context";
import { getScopeTree, type Scope } from "./root";

/**
 * The one store key the scope tree is carried under. It is fixed and owned here: nothing reaches
 * `createAsyncContextStore` for scopes except {@link getScopeStore}, so there is no second,
 * independent scope store to create.
 */
const SCOPE_STORE_KEY = "scope";

/**
 * The store carrying the current scope, whose value outside any propagation is the realm's default
 * scope. Every call returns a handle on the same `globalThis` slot, so a propagation or an installed
 * carrier made through one handle is seen through all of them, from every copy of the package.
 */
export function getScopeStore(): AsyncContextStore<Scope> {
  return createAsyncContextStore<Scope>(SCOPE_STORE_KEY, getScopeTree().defaultScope);
}
