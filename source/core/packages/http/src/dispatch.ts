import { type HttpBody, isOneShotBody, toReadableStream } from "./body";
import type { Terminal } from "./chain";
import { type HttpContext, type HttpFetch, type HttpRequest, markSent, wasSent } from "./context";
import { HttpConfigError } from "./errors/http-errors";

/** `RequestInit` with the `duplex` member a streaming request body needs, absent from the DOM lib. */
type DispatchInit = RequestInit & { duplex?: "half" };

/**
 * The request object dispatch sent for each response its `fetch` produced.
 *
 * A module-level map rather than a `globalThis` slot: it is written by `dispatch` and read by the
 * request builder, and both always come from the same copy of the package.
 */
const dispatchedRequests = new WeakMap<Response, HttpRequest>();

/**
 * The request object dispatch sent for `response`, or `undefined` when dispatch did not produce it
 * (a filter built or cached it). A filter that mutates that object after dispatch is reflected here.
 */
export function dispatchedRequest(response: Response): HttpRequest | undefined {
  return dispatchedRequests.get(response);
}

/**
 * The fetch a client dispatches through: `injected`, or the realm's `fetch`.
 *
 * A native `fetch` called as a method of anything but `window` (or `globalThis`) throws "Illegal
 * invocation" in browsers. An injected `fetch` is therefore called as a plain function, with `this`
 * undefined, so a native `fetch` passed in detached is never invoked as a method of some other
 * object. The default calls `globalThis.fetch` as a method of `globalThis`, read on every call, so a
 * `fetch` installed or stubbed after the client is built is the one used.
 */
export function resolveFetch(injected?: HttpFetch): HttpFetch {
  if (injected !== undefined) {
    return (input, init) => injected(input, init);
  }
  return (input, init) => globalThis.fetch(input, init);
}

/**
 * Sends `ctx.request` through `ctx.fetch` and resolves with its response.
 *
 * The URL goes as its `href` and no `Request` is built. `body` and `signal` are set on the init
 * only when the request carries them, so a request without a body has no `body` key. A replayable
 * body is passed as it is. A one-shot body is recorded as sent in a realm-wide record, reaches
 * `fetch` as a `ReadableStream` (an async iterable is wrapped, a stream passed as it is) with
 * `duplex: "half"`, and a second dispatch of the same object rejects with {@link HttpConfigError}
 * without calling `fetch`, whether it comes from a fork of the same call, another terminal call on
 * the same builder, a derived builder or another client. A rejection from `fetch` propagates
 * unchanged; nothing throws synchronously. The response is recorded against `ctx.request`, read
 * back through {@link dispatchedRequest}.
 */
export const dispatch: Terminal = async (ctx: HttpContext): Promise<Response> => {
  const { url, method, headers, body, signal } = ctx.request;
  const init: DispatchInit = { method, headers };
  if (signal !== undefined) {
    init.signal = signal;
  }
  if (body !== undefined && body !== null) {
    if (isOneShotBody(body)) {
      const oneShot = body as ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
      if (wasSent(oneShot)) {
        throw new HttpConfigError(
          `${method} ${url.origin}${url.pathname}: a one-shot body cannot be sent twice; a filter that retries must supply a fresh body`,
        );
      }
      markSent(oneShot);
      init.body = oneShot instanceof ReadableStream ? oneShot : toReadableStream(oneShot);
      init.duplex = "half";
    } else {
      init.body = body as Exclude<HttpBody, AsyncIterable<Uint8Array>>;
    }
  }
  const response = await ctx.fetch(url.href, init);
  dispatchedRequests.set(response, ctx.request);
  return response;
};
