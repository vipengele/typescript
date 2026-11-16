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
  /**
   * The attempt number: 1 for the root context, one more for each `fork`. Under the retry filter
   * each attempt's context carries the retry policy's attempt number, 1 to n.
   */
  readonly attempt: number;
  /** The function dispatch sends the request through. */
  readonly fetch: HttpFetch;
  /** Whether the request's current body can be sent again, read from `request.body` on each access. */
  readonly replayable: boolean;
  /**
   * A context for another attempt: its own copy of the URL and headers, the same body, signal and
   * attributes, and `attempt` one higher.
   */
  fork(): HttpContext;
}

/**
 * The `globalThis` slot holding every one-shot body dispatched in the realm.
 *
 * A one-shot body can be read once, whichever call, builder or client sends it, so the record of
 * sent bodies is realm-wide: one `WeakSet` behind a `Symbol.for` key that every resolved copy of the
 * package reads and writes. A per-call record would let a second call re-send an exhausted iterator
 * as an empty body, or hand `fetch` a locked stream.
 */
const SENT_ONE_SHOT_BODIES = Symbol.for("vipengele:http:sent-one-shot-bodies");

function sentOneShotBodies(): WeakSet<object> {
  const registry = globalThis as unknown as Record<symbol, WeakSet<object> | undefined>;
  let sent = registry[SENT_ONE_SHOT_BODIES];
  if (sent === undefined) {
    sent = new WeakSet();
    registry[SENT_ONE_SHOT_BODIES] = sent;
  }
  return sent;
}

class Context implements HttpContext {
  readonly request: HttpRequest;
  readonly attributes: Map<string | symbol, unknown>;
  readonly attempt: number;
  readonly fetch: HttpFetch;

  constructor(request: HttpRequest, fetch: HttpFetch, attributes: Map<string | symbol, unknown>, attempt: number) {
    this.request = request;
    this.fetch = fetch;
    this.attributes = attributes;
    this.attempt = attempt;
  }

  get replayable(): boolean {
    return !isOneShotBody(this.request.body);
  }

  fork(): HttpContext {
    return createAttemptContext(this, this.attempt + 1);
  }
}

/**
 * A context for attempt number `attempt` of `source`'s call: its own copy of the URL and headers,
 * the same body, signal, attributes and fetch.
 *
 * Reads only the public {@link HttpContext} fields, so `source` may come from another resolved copy
 * of the package or be any object implementing the interface.
 */
export function createAttemptContext(source: HttpContext, attempt: number): HttpContext {
  const { url, method, headers, body, signal } = source.request;
  const request: HttpRequest = { url: new URL(url.href), method, headers: new Headers(headers), body, signal };
  return new Context(request, source.fetch, source.attributes, attempt);
}

/** Creates the root context of a logical call: attempt 1. */
export function createRootContext(
  request: HttpRequest,
  fetch: HttpFetch,
  attributes: Map<string | symbol, unknown> = new Map(),
): HttpContext {
  return new Context(request, fetch, attributes, 1);
}

/** Records the one-shot `body` as dispatched, for every call in the realm. */
export function markSent(body: object): void {
  sentOneShotBodies().add(body);
}

/** Whether the one-shot `body` was already dispatched by any call in the realm. */
export function wasSent(body: object): boolean {
  return sentOneShotBodies().has(body);
}
