import type { HttpContext } from "./context";
import { HttpConfigError } from "./errors/http-errors";

/**
 * The conventional `order` of each built-in filter. A lower order runs further out: it sees the
 * request first and the response last.
 */
export const Order = Object.freeze({
  OBSERVABILITY: 100,
  AUTH: 200,
  RETRY: 1000,
  CIRCUIT_BREAKER: 1100,
  RATE_LIMITER: 1200,
  TIMEOUT: 1300,
  BULKHEAD: 1400,
  ATTEMPT: 2000,
} as const);

/**
 * Runs the rest of the chain. Called with no argument it passes on the context the filter
 * received; it may be called more than once, and each call runs everything downstream again.
 */
export type Next = (ctx?: HttpContext) => Promise<Response>;

/** One step of a client's filter chain. */
export interface Filter {
  /** Names the filter in configuration errors. */
  readonly name: string;
  /** Where the filter sits in the chain; lower runs further out. See {@link Order}. */
  readonly order: number;
  /** Whether the filter accepts sharing its `order` with another; a tie needs every filter at that order to accept it. */
  readonly allowsOrderTie?: boolean;
  /** Handles one pass through the chain, calling `next` to continue it. */
  handle(ctx: HttpContext, next: Next): Promise<Response>;
}

/**
 * Builds a frozen {@link Filter} from its parts.
 *
 * @throws HttpConfigError when `name` is not a non-empty string or `order` is not a finite number.
 */
export function filter(spec: Filter): Filter {
  const { name, order, allowsOrderTie, handle } = spec;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpConfigError("A filter needs a non-empty name");
  }
  if (typeof order !== "number" || !Number.isFinite(order)) {
    throw new HttpConfigError(`Filter "${name}" needs a finite order, got ${String(order)}`);
  }
  return Object.freeze({ name, order, allowsOrderTie: allowsOrderTie === true, handle });
}
