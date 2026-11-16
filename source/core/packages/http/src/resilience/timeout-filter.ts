import type { TimeoutPolicy } from "@vipengele/ts-core-resilience";
import { type Filter, filter, Order } from "../filter";

function noop(): void {}

/**
 * A filter, named `"timeout"` at {@link Order.TIMEOUT}, that runs the rest of the chain under
 * `policy`.
 *
 * The received context's `request.signal` is the policy's caller signal and, while the rest of the
 * chain runs, is replaced by the policy's composed signal, so the timer reaches `fetch`; it is put
 * back once the rest of the chain settles. The context is the one the filter receives: behind
 * `retryFilter` each attempt has its own, so each attempt gets its own timeout; without one it
 * is the call's root context and the timeout covers the whole call.
 *
 * When the timeout fires the call rejects with the policy's `OperationTimeoutError`. A `Response`
 * that arrives after that is never returned, so its body is cancelled.
 */
export function timeoutFilter(policy: TimeoutPolicy): Filter {
  return filter({
    name: "timeout",
    order: Order.TIMEOUT,
    async handle(ctx, next) {
      const callerSignal = ctx.request.signal;
      let abandoned = false;
      let arrived: Response | undefined;
      try {
        return await policy.execute(
          async ({ signal }) => {
            ctx.request.signal = signal;
            try {
              arrived = await next(ctx);
            } finally {
              ctx.request.signal = callerSignal;
            }
            if (abandoned) {
              arrived.body?.cancel().catch(noop);
            }
            return arrived;
          },
          { signal: callerSignal },
        );
      } catch (error) {
        abandoned = true;
        arrived?.body?.cancel().catch(noop);
        throw error;
      }
    },
  });
}
