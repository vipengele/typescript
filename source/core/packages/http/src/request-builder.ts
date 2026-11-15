import type { HttpBody } from "./body";
import type { ClientConfig } from "./client-config";
import { createRootContext, type HttpRequest } from "./context";
import { HttpConfigError, HttpStatusError } from "./errors/http-errors";
import { cancelBody, decodeJson, type HttpResponse, toHttpResponse } from "./http-response";
import { resolveUrl } from "./url";

/**
 * One request, built up step by step and sent by a terminal method.
 *
 * Immutable: every setter returns a new builder and leaves this one unchanged, so a builder can
 * be shared and extended from. It is not thenable; nothing is sent until a terminal is called,
 * and each terminal call sends the request again.
 */
export interface RequestBuilder {
  /** Sets a header on this request, replacing any value of the same name; it wins over a client header. */
  header(name: string, value: string): RequestBuilder;
  /** Appends a query parameter, keeping any query the URL already carries. */
  query(name: string, value: string | number | boolean): RequestBuilder;
  /**
   * Serializes `body` with `JSON.stringify` now and sends it as the body, with
   * `content-type: application/json` when no `content-type` is present at send time.
   * Replaces any earlier `body` or `json` body.
   *
   * @throws HttpConfigError when `body` does not serialize: `undefined`, a function or symbol, or a
   *   value `JSON.stringify` throws on (a cycle, a `BigInt`), the thrown error being the `cause`.
   */
  json(body: unknown): RequestBuilder;
  /**
   * Sends the request with `accept: application/json` when no `accept` is present, and reads the
   * body as JSON. An empty body resolves `undefined` (status 204 or 205, a `HEAD` request, or a
   * zero-length body), so `T` includes `undefined` when the endpoint can answer empty. Invalid
   * JSON rejects with the parser's `SyntaxError`.
   *
   * @throws HttpStatusError for status 400 and above, whatever `throwOnError` says; the body is
   *   left unread.
   */
  json<T = unknown>(): Promise<T>;
  /** Sets a raw body, sent as it is with no automatic `content-type`. Replaces any earlier `body` or `json` body. */
  body(body: HttpBody): RequestBuilder;
  /** Sets the signal that aborts the request. */
  signal(signal: AbortSignal): RequestBuilder;
  /** Sets a value in the attributes every filter of the call sees. */
  attribute(key: string | symbol, value: unknown): RequestBuilder;
  /**
   * Sends the request and resolves with the `Response`.
   *
   * @throws HttpStatusError for status 400 and above when the client sets `throwOnError`; the body
   *   is left unread.
   */
  send(): Promise<Response>;
  /** Sends the request and resolves with an {@link HttpResponse} whatever its status. */
  exchange(): Promise<HttpResponse>;
  /**
   * Sends the request and reads the body as text.
   *
   * @throws HttpStatusError for status 400 and above, whatever `throwOnError` says; the body is left unread.
   */
  text(): Promise<string>;
  /**
   * Sends the request and cancels the body unread.
   *
   * @throws HttpStatusError for status 400 and above, whatever `throwOnError` says; the body is left unread.
   */
  void(): Promise<void>;
}

/** What a builder carries. Never mutated: each setter copies what it changes. */
interface BuilderState {
  readonly config: ClientConfig;
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: HttpBody | undefined;
  readonly jsonBody: boolean;
  readonly signal: AbortSignal | undefined;
  readonly attributes: ReadonlyMap<string | symbol, unknown>;
}

/** The request a terminal sent and the response the chain produced for it. */
interface Exchanged {
  readonly request: HttpRequest;
  readonly response: Response;
}

const JSON_MEDIA_TYPE = "application/json";

function statusError({ request, response }: Exchanged): HttpStatusError {
  return new HttpStatusError({ method: request.method, url: request.url, response });
}

class Builder implements RequestBuilder {
  readonly #state: BuilderState;

  constructor(state: BuilderState) {
    this.#state = state;
  }

  #with(changes: Partial<BuilderState>): Builder {
    return new Builder({ ...this.#state, ...changes });
  }

  header(name: string, value: string): RequestBuilder {
    const headers = new Headers(this.#state.headers);
    headers.set(name, value);
    return this.#with({ headers });
  }

  query(name: string, value: string | number | boolean): RequestBuilder {
    const url = new URL(this.#state.url.href);
    url.searchParams.append(name, String(value));
    return this.#with({ url });
  }

  json(body: unknown): RequestBuilder;
  json<T = unknown>(): Promise<T>;
  json<T>(...args: [] | [unknown]): RequestBuilder | Promise<T> {
    if (args.length === 0) {
      return this.#exchange(true).then((exchanged) => {
        if (exchanged.response.status >= 400) {
          throw statusError(exchanged);
        }
        return decodeJson<T>(exchanged.response, exchanged.request.method);
      });
    }
    let text: string | undefined;
    try {
      text = JSON.stringify(args[0]);
    } catch (cause) {
      throw new HttpConfigError("The JSON body does not serialize", { cause });
    }
    if (text === undefined) {
      throw new HttpConfigError("The JSON body serializes to nothing; give a value JSON can represent");
    }
    return this.#with({ body: text, jsonBody: true });
  }

  body(body: HttpBody): RequestBuilder {
    return this.#with({ body, jsonBody: false });
  }

  signal(signal: AbortSignal): RequestBuilder {
    return this.#with({ signal });
  }

  attribute(key: string | symbol, value: unknown): RequestBuilder {
    const attributes = new Map(this.#state.attributes);
    attributes.set(key, value);
    return this.#with({ attributes });
  }

  async send(): Promise<Response> {
    const exchanged = await this.#exchange(false);
    if (this.#state.config.throwOnError && exchanged.response.status >= 400) {
      throw statusError(exchanged);
    }
    return exchanged.response;
  }

  async exchange(): Promise<HttpResponse> {
    const { request, response } = await this.#exchange(false);
    return toHttpResponse(response, request.method);
  }

  async text(): Promise<string> {
    const exchanged = await this.#exchange(false);
    if (exchanged.response.status >= 400) {
      throw statusError(exchanged);
    }
    return exchanged.response.text();
  }

  async void(): Promise<void> {
    const exchanged = await this.#exchange(false);
    if (exchanged.response.status >= 400) {
      throw statusError(exchanged);
    }
    await cancelBody(exchanged.response);
  }

  /**
   * Builds the request and runs it through the client's chain. Client headers come first and the
   * request's own replace them; `content-type` and, when `acceptJson` is set, `accept` default to
   * JSON only when absent. Every call gets its own URL, headers and attributes.
   */
  async #exchange(acceptJson: boolean): Promise<Exchanged> {
    const { config, method, url, body, jsonBody, signal, attributes } = this.#state;
    const headers = new Headers(config.headers);
    for (const [name, value] of this.#state.headers) {
      headers.set(name, value);
    }
    if (jsonBody && !headers.has("content-type")) {
      headers.set("content-type", JSON_MEDIA_TYPE);
    }
    if (acceptJson && !headers.has("accept")) {
      headers.set("accept", JSON_MEDIA_TYPE);
    }
    const request: HttpRequest = { url: new URL(url.href), method, headers, body, signal };
    const response = await config.chain(createRootContext(request, config.fetch, new Map(attributes)));
    return { request, response };
  }
}

/**
 * Starts a request for a client built on `config`: `method` upper-cased, `url` resolved against
 * `config.baseUrl` now.
 *
 * @throws HttpConfigError when `url` does not resolve; see `resolveUrl`.
 */
export function createRequestBuilder(config: ClientConfig, method: string, url: string | URL): RequestBuilder {
  return new Builder({
    config,
    method: method.toUpperCase(),
    url: resolveUrl(url, config.baseUrl),
    headers: new Headers(),
    body: undefined,
    jsonBody: false,
    signal: undefined,
    attributes: new Map(),
  });
}
