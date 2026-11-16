import type { BulkheadPolicy } from "@vipengele/ts-core-resilience";
import { type Filter, filter, Order } from "../filter";

/**
 * A filter, named `"bulkhead"` at {@link Order.BULKHEAD}, that runs the rest of the chain under
 * `policy`, with the request's signal as the policy's caller signal.
 *
 * A call holds a permit until the rest of the chain settles. When every permit is taken and the
 * queue is full, or a queued call waits past the policy's `maxWaitMs`, the filter rejects with the
 * policy's `BulkheadFullError` and the rest of the chain does not run.
 */
export function bulkheadFilter(policy: BulkheadPolicy): Filter {
  return filter({
    name: "bulkhead",
    order: Order.BULKHEAD,
    handle: (ctx, next) => policy.execute(() => next(ctx), { signal: ctx.request.signal }),
  });
}
