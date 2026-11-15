import type { HttpContext } from "./context";
import { HttpConfigError } from "./errors/http-errors";
import type { Filter } from "./filter";

/** The innermost step of a chain, reached by the last filter's `next`; dispatch in a client. */
export type Terminal = (ctx: HttpContext) => Promise<Response>;

/**
 * Sorts `filters` ascending by `order`, keeping registration order among equal orders.
 *
 * @throws HttpConfigError when filters share an order and any one of them does not set
 *   `allowsOrderTie`; the message names the first filter at that order and the first one that does not opt in
 *   (or, when the first does not, the second).
 */
export function sortFilters(filters: readonly Filter[]): Filter[] {
  const sorted = [...filters].sort((a, b) => a.order - b.order);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && (sorted[end] as Filter).order === (sorted[start] as Filter).order) {
      end++;
    }
    const tied = sorted.slice(start, end);
    const refusing = tied.findIndex((candidate) => candidate.allowsOrderTie !== true);
    if (tied.length > 1 && refusing !== -1) {
      const first = tied[0] as Filter;
      const second = tied[refusing === 0 ? 1 : refusing] as Filter;
      throw new HttpConfigError(
        `Filters "${first.name}" and "${second.name}" share order ${first.order}; a tie needs allowsOrderTie on every filter at that order`,
      );
    }
    start = end;
  }
  return sorted;
}

/**
 * Chains `filters`, already in running order, in front of `terminal`.
 *
 * Each filter's `next` runs the following filter, and the last one's runs `terminal`, with the
 * context it is given or, given none, the context the filter received. A filter or terminal that
 * throws synchronously gives a rejected promise.
 */
export function compose(filters: readonly Filter[], terminal: Terminal): Terminal {
  const chain = [...filters];
  const run = async (index: number, ctx: HttpContext): Promise<Response> => {
    const current = chain[index];
    if (current === undefined) {
      return terminal(ctx);
    }
    return current.handle(ctx, (next = ctx) => run(index + 1, next));
  };
  return (ctx) => run(0, ctx);
}

/** Validates and sorts `filters`, then chains them in front of `terminal`; see {@link sortFilters}. */
export function compileChain(filters: readonly Filter[], terminal: Terminal): Terminal {
  return compose(sortFilters(filters), terminal);
}
