import { type AsyncContextStore, createAsyncContextStore } from "../context";
import { getScopeTree, type Scope } from "./root";

/**
 * The one store key the scope tree is carried under. It is fixed and owned here: nothing reaches
 * `createAsyncContextStore` for scopes except {@link getScopeStore}, so there is no second,
 * independent scope store to create.
 */
const SCOPE_STORE_KEY = "scope";

let store: AsyncContextStore<Scope> | undefined;

/**
 * The store carrying the current scope, whose value outside any propagation is the realm's default
 * scope. The handle is memoized per copy of the package, but every handle reads and writes the same
 * `globalThis` slot, so a propagation or an installed carrier made through one is seen through all
 * of them, from every copy — memoizing costs nothing that reading the slot fresh would have bought.
 */
export function getScopeStore(): AsyncContextStore<Scope> {
  store ??= createAsyncContextStore<Scope>(SCOPE_STORE_KEY, getScopeTree().defaultScope);
  return store;
}
