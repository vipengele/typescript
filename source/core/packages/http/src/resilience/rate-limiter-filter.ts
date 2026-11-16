import type { RateLimiterPolicy } from "@vipengele/ts-core-resilience";
import { type Filter, filter, Order } from "../filter";

/**
 * A filter, named `"rate-limiter"` at {@link Order.RATE_LIMITER}, that runs the rest of the chain
 * under `policy`, with the request's signal as the policy's caller signal.
 *
 * A call waits for a permit up to the policy's `maxWaitMs`; when none comes in time the filter
 * rejects with the policy's `RateLimitExceededError` and the rest of the chain does not run. A
 * caller abort during the wait rejects with the signal's reason.
 */
export function rateLimiterFilter(policy: RateLimiterPolicy): Filter {
  return filter({
    name: "rate-limiter",
    order: Order.RATE_LIMITER,
    handle: (ctx, next) => policy.execute(() => next(ctx), { signal: ctx.request.signal }),
  });
}
