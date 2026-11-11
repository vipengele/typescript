import { ResilienceConfigError } from "../errors";
import type { RegistryBuilder } from "./builder";
import { createRegistry, type ResilienceRegistry } from "./registry";

/**
 * The realm-wide slot holding the default registry. `Symbol.for` gives every resolved copy of this
 * package the same key, and the module keeps no state of its own, so every copy reads and writes
 * the one registry behind it.
 */
const REGISTRY_SLOT = Symbol.for("vipengele.resilience.registry.v1");

type RegistrySlot = Record<typeof REGISTRY_SLOT, ResilienceRegistry | undefined>;

/**
 * A builder whose `clock` and `scheduler` throw: the default registry is shared by every copy of
 * the package in the realm, so it runs on the system clock and scheduler. Every other method
 * delegates to `inner` and returns the restricted builder, so a chain stays restricted.
 */
function restrict(inner: RegistryBuilder): RegistryBuilder {
  const restricted: RegistryBuilder = {
    defaults(kind, config) {
      inner.defaults(kind, config);
      return restricted;
    },
    configure(kind, name, config) {
      inner.configure(kind, name, config);
      return restricted;
    },
    fromConfig(layer) {
      inner.fromConfig(layer);
      return restricted;
    },
    clock() {
      throw new ResilienceConfigError(
        "The default registry runs on the system clock; use createRegistry for a registry with its own clock",
      );
    },
    scheduler() {
      throw new ResilienceConfigError(
        "The default registry runs on the system scheduler; use createRegistry for a registry with its own scheduler",
      );
    },
  };
  return restricted;
}

/**
 * The realm's shared {@link ResilienceRegistry}, held at
 * `globalThis[Symbol.for("vipengele.resilience.registry.v1")]` so every resolved copy of this
 * package hands out the same policies. Nothing is created when the module loads.
 *
 * The first call creates the registry, configured by `build` when given, on the system clock and
 * scheduler: the builder's `clock` and `scheduler` throw a {@link ResilienceConfigError}. When that
 * first `build` throws, the error reaches the caller and the slot stays empty, so a later call
 * creates the registry afresh. Once the registry exists, a call without `build` returns it and a
 * call with one throws a {@link ResilienceConfigError}: the shared registry is configured once.
 *
 * A test that needs its own clock, scheduler or configuration uses `createRegistry`.
 *
 * The tests import this module a second time under a query string to show two instances of it
 * agree through the slot; that does not load a second copy of the registry or policy code. Across
 * real copies of the package, the `Symbol.for` key and the absence of module-level state carry the
 * guarantee.
 */
export function defaultRegistry(build?: (builder: RegistryBuilder) => unknown): ResilienceRegistry {
  const realm = globalThis as unknown as RegistrySlot;
  const existing = realm[REGISTRY_SLOT];
  if (existing !== undefined) {
    if (build !== undefined) {
      throw new ResilienceConfigError(
        "The default registry already exists; configure it with the build passed to the first defaultRegistry call",
      );
    }
    return existing;
  }
  const registry = createRegistry(build === undefined ? undefined : (inner) => build(restrict(inner)));
  realm[REGISTRY_SLOT] = registry;
  return registry;
}
