import type { BulkheadConfig, BulkheadPolicy } from "../bulkhead";
import type { CircuitBreakerConfig, CircuitBreakerPolicy } from "../circuit-breaker";
import { isResilienceConfigError, ResilienceConfigError } from "../errors";
import { compose } from "../compose";
import { createEmitter } from "../listenable";
import type { RateLimiterConfig, RateLimiterPolicy } from "../rate-limiter";
import type { RetryConfig, RetryPolicy } from "../retry";
import type { TimeoutConfig, TimeoutPolicy } from "../timeout";
import type { Listenable, Policy } from "../types";
import { createBuilder, type RegistryBuilder, type RegistrySettings } from "./builder";
import { builtInDefaults } from "./defaults";
import { createPolicy, mergeConfig, requireKind, requireName } from "./policy-table";
import type { ConfigOf, PolicyKind, PolicyOf, ResilienceEvent } from "./types";

/**
 * Creates and holds named policies, one instance per kind and name. Each method returns the
 * policy of its kind called `name`, creating it on first use from the effective config the
 * {@link RegistryBuilder} describes, with `override` merged on top. An `override` other than
 * `undefined` for a policy that already exists throws a {@link ResilienceConfigError}, whatever
 * it holds: the instance already runs on the config it was created with. Policies of different
 * kinds sharing a name are distinct instances.
 *
 * Every method throws a {@link ResilienceConfigError} for an empty `name`, and wraps a factory's
 * {@link ResilienceConfigError} in one that names the kind and the name, the original as `cause`.
 */
export interface ResilienceRegistry {
  /** Every event of every policy this registry has created, whenever the listener was added. */
  readonly events: Listenable<ResilienceEvent>;
  retry(name: string, override?: Partial<RetryConfig>): RetryPolicy;
  circuitBreaker(name: string, override?: Partial<CircuitBreakerConfig>): CircuitBreakerPolicy;
  rateLimiter(name: string, override?: Partial<RateLimiterConfig>): RateLimiterPolicy;
  timeout(name: string, override?: Partial<TimeoutConfig>): TimeoutPolicy;
  bulkhead(name: string, override?: Partial<BulkheadConfig>): BulkheadPolicy;
  /**
   * Composes the policies called `name` into one {@link Policy} named `name`, outermost first in
   * the fixed order retry > circuitBreaker > rateLimiter > timeout > bulkhead, whatever order
   * `options.kinds` lists them in. Without `kinds`, the pipeline takes every kind that has a
   * `configure` entry for `name` or an instance called `name`; a kind-level `defaults` entry does
   * not count.
   *
   * The pipeline reuses each existing instance and creates the missing ones from their effective
   * config, with no override. It creates all of them before caching any, so when one fails none is
   * cached. An instance it creates is then an existing instance like any other: a later override
   * on it throws. Each call returns a new composed policy over the cached instances; the composed
   * policy carries no `events`, which reach {@link ResilienceRegistry.events} as for any instance.
   *
   * Throws a {@link ResilienceConfigError} for an empty `name`, for an empty `kinds`, one that
   * repeats a kind or names an unknown one, and when `kinds` is omitted and no kind has a
   * `configure` entry or an instance called `name`.
   */
  pipeline(name: string, options?: PipelineOptions): Policy;
}

/** Options for {@link ResilienceRegistry.pipeline}. */
export interface PipelineOptions {
  /** The kinds to compose, in any order; defaults to those configured or created for the name. */
  readonly kinds?: readonly PolicyKind[];
}

/** The nesting order of a pipeline, outermost first. */
const PIPELINE_ORDER: readonly PolicyKind[] = ["retry", "circuitBreaker", "rateLimiter", "timeout", "bulkhead"];

type InstancesByKind = { [K in PolicyKind]: Map<string, PolicyOf<K>> };

/** The registry's instances and the steps that create them, kept apart so a caller can create several before caching any. */
export interface PolicyStore {
  readonly settings: RegistrySettings;
  readonly events: Listenable<ResilienceEvent>;
  /** The instance of `kind` called `name`, or `undefined` when none was created. */
  existing<K extends PolicyKind>(kind: K, name: string): PolicyOf<K> | undefined;
  /** Creates, without caching, a policy from its effective config with `override` on top. */
  build<K extends PolicyKind>(kind: K, name: string, override: Partial<ConfigOf<K>> | undefined): PolicyOf<K>;
  /** Caches `policy` as the instance of `kind` called `name` and forwards its events. */
  adopt<K extends PolicyKind>(kind: K, name: string, policy: PolicyOf<K>): void;
  /** The cached instance, or a freshly built and adopted one; throws for an override on an existing instance. */
  getOrCreate<K extends PolicyKind>(kind: K, name: string, override: Partial<ConfigOf<K>> | undefined): PolicyOf<K>;
}

const LAYER_ORDER = "built-in defaults ← defaults ← configure ← override";

export function createPolicyStore(settings: RegistrySettings): PolicyStore {
  const emitter = createEmitter<ResilienceEvent>();
  const instances: InstancesByKind = {
    retry: new Map(),
    circuitBreaker: new Map(),
    rateLimiter: new Map(),
    timeout: new Map(),
    bulkhead: new Map(),
  };

  const store: PolicyStore = {
    settings,
    events: emitter.listenable,
    existing: (kind, name) => instances[kind].get(name),
    build(kind, name, override) {
      requireName(kind, name);
      const config = mergeConfig(builtInDefaults[kind], [
        ...settings.defaultsOf(kind),
        ...(settings.configuredOf(kind, name) ?? []),
        { ...override },
      ]);
      try {
        return createPolicy(kind, name, config, settings.deps);
      } catch (error) {
        if (isResilienceConfigError(error)) {
          throw new ResilienceConfigError(
            `Cannot create ${kind} "${name}": its effective config merges ${LAYER_ORDER}, so the failing field may come from any layer. ${error.message}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
    adopt(kind, name, policy) {
      const events: Listenable<ResilienceEvent> = policy.events;
      events.on((event) => emitter.emit(event));
      instances[kind].set(name, policy);
    },
    getOrCreate(kind, name, override) {
      requireName(kind, name);
      const found = store.existing(kind, name);
      if (found !== undefined) {
        if (override !== undefined) {
          throw new ResilienceConfigError(`The ${kind} "${name}" already exists; an override applies only to the call that creates it`);
        }
        return found;
      }
      const policy = store.build(kind, name, override);
      store.adopt(kind, name, policy);
      return policy;
    },
  };
  return store;
}

function pipelineKinds(store: PolicyStore, name: string, kinds: readonly PolicyKind[] | undefined): PolicyKind[] {
  if (kinds === undefined) {
    const found = PIPELINE_ORDER.filter(
      (kind) => store.settings.configuredOf(kind, name) !== undefined || store.existing(kind, name) !== undefined,
    );
    if (found.length === 0) {
      throw new ResilienceConfigError(`The pipeline "${name}" has no kinds: no policy called "${name}" is configured or created`);
    }
    return found;
  }
  if (kinds.length === 0) {
    throw new ResilienceConfigError(`The pipeline "${name}" needs at least one kind`);
  }
  for (const kind of kinds) {
    requireKind(kind);
  }
  if (new Set(kinds).size !== kinds.length) {
    throw new ResilienceConfigError(`The pipeline "${name}" lists a kind more than once: ${kinds.join(", ")}`);
  }
  return PIPELINE_ORDER.filter((kind) => kinds.includes(kind));
}

/**
 * The instance of `kind` called `name`, in two steps: the existing instance, or one built now
 * without caching, then a commit that caches a built one and returns the instance either way.
 */
function prepare<K extends PolicyKind>(store: PolicyStore, kind: K, name: string): () => PolicyOf<K> {
  const found = store.existing(kind, name);
  if (found !== undefined) {
    return () => found;
  }
  const policy = store.build(kind, name, undefined);
  return () => {
    store.adopt(kind, name, policy);
    return policy;
  };
}

/** Builds every missing instance before adopting any, so a failing one leaves none cached. */
function createPipeline(store: PolicyStore, name: string, options: PipelineOptions | undefined): Policy {
  if (name === "") {
    throw new ResilienceConfigError("A registry pipeline needs a non-empty name");
  }
  const kinds = pipelineKinds(store, name, options?.kinds);
  const commits = kinds.map((kind) => prepare(store, kind, name));
  const composed = compose(...commits.map((commit): Policy => commit()));
  return { name, execute: composed.execute };
}

/**
 * Creates a {@link ResilienceRegistry}, configured by `build` when given. `build` receives a
 * {@link RegistryBuilder} and runs once, synchronously; its return value is ignored, and the
 * builder throws for any use after it returns.
 */
export function createRegistry(build?: (builder: RegistryBuilder) => unknown): ResilienceRegistry {
  const { builder, seal } = createBuilder();
  build?.(builder);
  const store = createPolicyStore(seal());
  return {
    events: store.events,
    retry: (name, override) => store.getOrCreate("retry", name, override),
    circuitBreaker: (name, override) => store.getOrCreate("circuitBreaker", name, override),
    rateLimiter: (name, override) => store.getOrCreate("rateLimiter", name, override),
    timeout: (name, override) => store.getOrCreate("timeout", name, override),
    bulkhead: (name, override) => store.getOrCreate("bulkhead", name, override),
    pipeline: (name, options) => createPipeline(store, name, options),
  };
}
