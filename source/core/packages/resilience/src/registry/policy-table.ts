import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import { createBulkhead } from "../bulkhead";
import { createCircuitBreaker } from "../circuit-breaker";
import { ResilienceConfigError } from "../errors";
import { createRateLimiter } from "../rate-limiter";
import { createRetry } from "../retry";
import { createTimeout } from "../timeout";
import type { ConfigOf, PolicyKind, PolicyOf } from "./types";

/** The collaborators a registry hands every factory; a circuit breaker takes only `clock`. */
export interface PolicyDeps {
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
}

type Factory<K extends PolicyKind> = (name: string, config: ConfigOf<K>, deps: PolicyDeps) => PolicyOf<K>;

/** The one factory per kind; a kind missing here fails the `satisfies` check. */
const policyTable = {
  retry: (name, config, deps) => createRetry(name, config, deps),
  circuitBreaker: (name, config, deps) => createCircuitBreaker(name, config, { clock: deps.clock }),
  rateLimiter: (name, config, deps) => createRateLimiter(name, config, deps),
  timeout: (name, config, deps) => createTimeout(name, config, deps),
  bulkhead: (name, config, deps) => createBulkhead(name, config, deps),
} satisfies { readonly [K in PolicyKind]: Factory<K> };

const factories: { readonly [K in PolicyKind]: Factory<K> } = policyTable;

/** Narrows a kind that arrived as a runtime value, from untyped config say, to a {@link PolicyKind}. */
export function isPolicyKind(value: unknown): value is PolicyKind {
  return typeof value === "string" && Object.hasOwn(policyTable, value);
}

/** Runs the factory for `kind`. Its validation errors reach the caller unchanged. */
export function createPolicy<K extends PolicyKind>(kind: K, name: string, config: ConfigOf<K>, deps: PolicyDeps): PolicyOf<K> {
  return factories[kind](name, config, deps);
}

/**
 * Shallow-merges `layers` onto `base` in order. A field whose value is `undefined` counts as not
 * set and is skipped, so a layer cannot unset a field an earlier one set; a nested object such as
 * `slidingWindow` is replaced whole.
 */
export function mergeConfig<K extends PolicyKind>(base: ConfigOf<K>, layers: ReadonlyArray<Partial<ConfigOf<K>>>): ConfigOf<K> {
  const merged = { ...base };
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        Object.assign(merged, { [key]: value });
      }
    }
  }
  return merged;
}

/** Throws a {@link ResilienceConfigError} unless `kind` names a policy kind. */
export function requireKind(kind: unknown): asserts kind is PolicyKind {
  if (!isPolicyKind(kind)) {
    throw new ResilienceConfigError(`Unknown policy kind ${JSON.stringify(kind)}; expected one of ${Object.keys(policyTable).join(", ")}`);
  }
}

/** Throws a {@link ResilienceConfigError} for an empty policy name. */
export function requireName(kind: PolicyKind, name: string): void {
  if (name === "") {
    throw new ResilienceConfigError(`A registry ${kind} needs a non-empty name`);
  }
}
