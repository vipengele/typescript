import { type HttpBody, isOneShotBody } from "./body";

/** The request a filter chain carries towards dispatch; filters may change any field. */
export interface HttpRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: HttpBody | null;
  signal?: AbortSignal;
}

/** The function dispatch sends a request through: `fetch`, or a stand-in with its shape. */
export type HttpFetch = (input: string, init: RequestInit) => Promise<Response>;

/** The state one attempt of one logical call carries through the filter chain. */
export interface HttpContext {
  /** The request as it stands; a filter may mutate it before calling `next`. */
  readonly request: HttpRequest;
  /** Values filters hand each other, shared by every fork of the call. */
  readonly attributes: Map<string | symbol, unknown>;
  /** The attempt number: 1 for the root context, one more for each `fork`. */
  readonly attempt: number;
  /** The function dispatch sends the request through. */
  readonly fetch: HttpFetch;
  /** Whether the request's current body can be sent again, read from `request.body` on each access. */
  readonly replayable: boolean;
  /**
   * A context for another attempt: its own copy of the URL and headers, the same body, signal,
   * attributes and sent-state, and `attempt` one higher.
   */
  fork(): HttpContext;
}

/**
 * The one-shot bodies each logical call has dispatched, keyed by every context of that call.
 *
 * Every fork of a call registers the same set, so a body sent by one attempt is seen as sent by all.
 */
const sentBodies = new WeakMap<HttpContext, WeakSet<object>>();

class Context implements HttpContext {
  readonly request: HttpRequest;
  readonly attributes: Map<string | symbol, unknown>;
  readonly attempt: number;
  readonly fetch: HttpFetch;

  constructor(request: HttpRequest, fetch: HttpFetch, attributes: Map<string | symbol, unknown>, attempt: number, sent: WeakSet<object>) {
    this.request = request;
    this.fetch = fetch;
    this.attributes = attributes;
    this.attempt = attempt;
    sentBodies.set(this, sent);
  }

  get replayable(): boolean {
    return !isOneShotBody(this.request.body);
  }

  fork(): HttpContext {
    const { url, method, headers, body, signal } = this.request;
    const request: HttpRequest = { url: new URL(url.href), method, headers: new Headers(headers), body, signal };
    return new Context(request, this.fetch, this.attributes, this.attempt + 1, sentBodies.get(this) as WeakSet<object>);
  }
}

/** Creates the root context of a logical call: attempt 1, with nothing yet sent. */
export function createRootContext(
  request: HttpRequest,
  fetch: HttpFetch,
  attributes: Map<string | symbol, unknown> = new Map(),
): HttpContext {
  return new Context(request, fetch, attributes, 1, new WeakSet());
}

/**
 * Records `body` as dispatched for the logical call `ctx` belongs to.
 *
 * A context not built by {@link createRootContext} or a `fork` of one has no sent-state, and the
 * call is a no-op for it.
 */
export function markSent(ctx: HttpContext, body: object): void {
  sentBodies.get(ctx)?.add(body);
}

/** Whether `body` was already dispatched by any attempt of the logical call `ctx` belongs to. */
export function wasSent(ctx: HttpContext, body: object): boolean {
  return sentBodies.get(ctx)?.has(body) ?? false;
}
