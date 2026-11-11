import { ResilienceConfigError } from "../errors";
import type { ExecuteOptions, ExecutionContext, Policy } from "../types";

type Operation<T> = (ctx: ExecutionContext) => Promise<T> | T;

/**
 * Runs `op` through `policies[index]` and every policy inside it. The layer's own `ctx.signal`
 * becomes the next layer's `options.signal`, and the next layer's `execute` is called from inside
 * this layer's operation with no `await` before it, so a policy that admits synchronously admits
 * in the same tick as the composed `execute` call.
 */
function runLayer<T>(
  policies: readonly Policy[],
  index: number,
  op: Operation<T>,
  options: ExecuteOptions | undefined,
  attempt: number,
): Promise<T> {
  const policy = policies[index] as Policy;
  return policy.execute((ctx) => {
    const seen = ctx.attempt > 1 ? ctx.attempt : attempt;
    if (index === policies.length - 1) {
      return op({ attempt: seen, signal: ctx.signal });
    }
    return runLayer(policies, index + 1, op, { signal: ctx.signal }, seen);
  }, options);
}

/**
 * Nests `policies` into one {@link Policy}, the first outermost: `compose(retry, breaker, timeout)`
 * retries calls through a breaker that guards a timed-out operation. The result is always a fresh
 * wrapper named after the policies' names joined by `" > "` — `compose(p)` is a wrapper named
 * `p.name`, not `p` itself — and carries no `events`; each policy keeps its own.
 *
 * The composed `execute`'s `options.signal` goes to the outermost policy, and each policy's
 * operation signal is the next one's caller signal, so a caller abort reaches the operation through
 * every layer. The operation receives the innermost policy's signal, and the attempt of the
 * nearest enclosing policy that reports an attempt above 1, else 1. Under nested retries that
 * attempt is neither unique nor monotonic: an outer retry's second attempt reaches the operation as
 * 2 through the inner retry's first, then the inner retry's second is 2 again and its third is 3.
 *
 * Throws a {@link ResilienceConfigError} when given no policies.
 */
export function compose(...policies: Policy[]): Policy {
  if (policies.length === 0) {
    throw new ResilienceConfigError("compose needs at least one policy");
  }
  const layers = [...policies];
  return {
    name: layers.map((policy) => policy.name).join(" > "),
    execute<T>(op: Operation<T>, options?: ExecuteOptions): Promise<T> {
      return runLayer(layers, 0, op, options, 1);
    },
  };
}
