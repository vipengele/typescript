import type { RetryExecuteOptions, RetryPolicy } from "@vipengele/ts-core-resilience";
import { createAttemptContext } from "../context";
import { type Filter, filter, Order } from "../filter";
import { defaultRetryPredicate, HttpResilienceAttributes, type RetryPredicateOptions } from "./predicates";

function noop(): void {}

/** Cancels the body of a `Response` nobody will read, so its connection is released. */
function discard(response: Response | undefined): void {
  response?.body?.cancel().catch(noop);
}

/**
 * A filter, named `"retry"` at {@link Order.RETRY}, that runs the rest of the chain under `policy`.
 *
 * The context the filter receives is kept untouched as the call's base. Every attempt, the first
 * included, runs the rest of the chain on a fresh context built from that base, with `attempt` set
 * to the policy's attempt number, so a change a filter further in makes to its context never
 * reaches the next attempt. Whether to retry and how long to wait come from
 * {@link defaultRetryPredicate} over the base and `options`, in place of the policy's own
 * predicates; the base request's signal is the policy's caller signal.
 *
 * A failing status is a `Response`, not an error: when the attempts run out on one, that
 * `Response` is returned for the status conversion after the chain. The body of every `Response`
 * that is not returned is cancelled: the previous attempt's when the next one starts, and the held
 * one when the policy rejects (its last error, or the caller's abort reason during a wait). The
 * number of attempts made is recorded on the shared attributes under
 * {@link HttpResilienceAttributes.attempts}, whether the call succeeds or fails.
 *
 * A request whose body can be sent only once is sent once and never retried.
 */
export function retryFilter(policy: RetryPolicy, options: RetryPredicateOptions = {}): Filter {
  return filter({
    name: "retry",
    order: Order.RETRY,
    async handle(base, next) {
      const { shouldRetry, retryAfter } = defaultRetryPredicate(base, options);
      const executeOptions: RetryExecuteOptions = { signal: base.request.signal, shouldRetry, retryAfter };
      let held: Response | undefined;
      let attempts = 0;
      try {
        return await policy.execute(async ({ attempt }) => {
          discard(held);
          held = undefined;
          attempts = attempt;
          held = await next(createAttemptContext(base, attempt));
          return held;
        }, executeOptions);
      } catch (error) {
        discard(held);
        throw error;
      } finally {
        base.attributes.set(HttpResilienceAttributes.attempts, attempts);
      }
    },
  });
}
