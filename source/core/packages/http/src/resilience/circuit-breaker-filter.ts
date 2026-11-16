import type { CircuitBreakerPolicy, Outcome } from "@vipengele/ts-core-resilience";
import { type Filter, filter, Order } from "../filter";
import { defaultIsFailure, HttpResilienceAttributes } from "./predicates";

export interface CircuitBreakerFilterOptions {
  /** Whether `outcome` counts against the circuit. Defaults to {@link defaultIsFailure}. */
  isFailure?(outcome: Outcome<unknown>): boolean;
}

/**
 * A filter, named `"circuit-breaker"` at {@link Order.CIRCUIT_BREAKER}, that runs the rest of the
 * chain under `policy`, with the request's signal as the policy's caller signal.
 *
 * A failing status is a `Response`, not an error: `options.isFailure`, or {@link defaultIsFailure}
 * (a thrown error, a 5xx, 408 or 429), decides whether it counts against the circuit, and the
 * `Response` is returned either way. While the circuit refuses calls the filter rejects with the
 * policy's `CircuitOpenError` and the rest of the chain does not run. The circuit's state, read
 * once the call has settled or been refused, is recorded on the shared attributes under
 * {@link HttpResilienceAttributes.circuitState}.
 */
export function circuitBreakerFilter(policy: CircuitBreakerPolicy, options: CircuitBreakerFilterOptions = {}): Filter {
  const isFailure = options.isFailure ?? defaultIsFailure;
  return filter({
    name: "circuit-breaker",
    order: Order.CIRCUIT_BREAKER,
    async handle(ctx, next) {
      try {
        return await policy.execute(() => next(ctx), { signal: ctx.request.signal, isFailure });
      } finally {
        ctx.attributes.set(HttpResilienceAttributes.circuitState, policy.state);
      }
    },
  });
}
