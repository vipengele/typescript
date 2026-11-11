import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import { ResilienceConfigError } from "../errors";
import { type PolicyDeps, requireKind, requireName } from "./policy-table";
import type { ConfigOf, PolicyKind, RegistryBuilderLayer } from "./types";

/**
 * Configures a registry inside `createRegistry`'s `build` callback. Every method returns the
 * builder, and every method throws a {@link ResilienceConfigError} once `build` has returned.
 *
 * A policy's effective config is the built-in defaults for its kind, then every `defaults` layer
 * for the kind, then every `configure` layer for its kind and name, then the override passed to
 * the call that creates it. Each step is a shallow merge in call order: a nested object such as
 * `slidingWindow` is replaced whole, and a field whose value is `undefined` counts as not set.
 */
export interface RegistryBuilder {
  /** Adds a layer every policy of `kind` inherits. Throws for an unknown `kind`. */
  defaults<K extends PolicyKind>(kind: K, config: Partial<ConfigOf<K>>): RegistryBuilder;
  /** Adds a layer the policy of `kind` called `name` inherits. Throws for an unknown `kind` or an empty `name`. */
  configure<K extends PolicyKind>(kind: K, name: string, config: Partial<ConfigOf<K>>): RegistryBuilder;
  /**
   * Adds `layer`'s `defaults` entries as `defaults` layers and its `configure` entries as
   * `configure` layers, in the place this call takes among the others. Throws for an unknown kind
   * or an empty name anywhere in `layer`.
   */
  fromConfig(layer: RegistryBuilderLayer): RegistryBuilder;
  /** The clock every policy the registry creates reads. */
  clock(clock: Clock): RegistryBuilder;
  /** The scheduler every policy the registry creates waits on; a circuit breaker takes none. */
  scheduler(scheduler: Scheduler): RegistryBuilder;
}

/** What a sealed builder hands the registry. */
export interface RegistrySettings {
  readonly deps: PolicyDeps;
  /** The `defaults` layers for `kind`, in call order. */
  defaultsOf<K extends PolicyKind>(kind: K): ReadonlyArray<Partial<ConfigOf<K>>>;
  /** The `configure` layers for `kind` and `name`, in call order; `undefined` when none was given. */
  configuredOf<K extends PolicyKind>(kind: K, name: string): ReadonlyArray<Partial<ConfigOf<K>>> | undefined;
}

type LayersByKind = { [K in PolicyKind]: Array<Partial<ConfigOf<K>>> };
type NamedLayersByKind = { [K in PolicyKind]: Map<string, Array<Partial<ConfigOf<K>>>> };

/**
 * A builder and the `seal` that ends its use. Each layer is copied when it is added, so a caller
 * mutating its config object afterwards changes nothing.
 */
export function createBuilder(): { readonly builder: RegistryBuilder; seal(): RegistrySettings } {
  const defaults: LayersByKind = { retry: [], circuitBreaker: [], rateLimiter: [], timeout: [], bulkhead: [] };
  const configured: NamedLayersByKind = {
    retry: new Map(),
    circuitBreaker: new Map(),
    rateLimiter: new Map(),
    timeout: new Map(),
    bulkhead: new Map(),
  };
  let deps: PolicyDeps = {};
  let sealed = false;

  function requireOpen(): void {
    if (sealed) {
      throw new ResilienceConfigError("A registry builder cannot be used after createRegistry's build callback returns");
    }
  }

  function addDefaults<K extends PolicyKind>(kind: K, config: Partial<ConfigOf<K>> | undefined): void {
    requireKind(kind);
    defaults[kind].push({ ...config });
  }

  function addConfigured<K extends PolicyKind>(kind: K, name: string, config: Partial<ConfigOf<K>> | undefined): void {
    requireKind(kind);
    requireName(kind, name);
    const byName = configured[kind];
    const layers = byName.get(name) ?? [];
    layers.push({ ...config });
    byName.set(name, layers);
  }

  function addLayer(layer: RegistryBuilderLayer): void {
    const layerDefaults = { ...layer.defaults };
    for (const kind of Object.keys(layerDefaults)) {
      requireKind(kind);
      addDefaults(kind, layerDefaults[kind]);
    }
    const layerConfigured = { ...layer.configure };
    for (const kind of Object.keys(layerConfigured)) {
      requireKind(kind);
      const byName: Readonly<Record<string, Partial<ConfigOf<typeof kind>>>> = { ...layerConfigured[kind] };
      for (const [name, config] of Object.entries(byName)) {
        addConfigured(kind, name, config);
      }
    }
  }

  const builder: RegistryBuilder = {
    defaults(kind, config) {
      requireOpen();
      addDefaults(kind, config);
      return builder;
    },
    configure(kind, name, config) {
      requireOpen();
      addConfigured(kind, name, config);
      return builder;
    },
    fromConfig(layer) {
      requireOpen();
      addLayer(layer);
      return builder;
    },
    clock(clock) {
      requireOpen();
      deps = { ...deps, clock };
      return builder;
    },
    scheduler(scheduler) {
      requireOpen();
      deps = { ...deps, scheduler };
      return builder;
    },
  };

  return {
    builder,
    seal() {
      sealed = true;
      const settled = deps;
      return {
        deps: settled,
        defaultsOf: (kind) => defaults[kind],
        configuredOf: (kind, name) => configured[kind].get(name),
      };
    },
  };
}
