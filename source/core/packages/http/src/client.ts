import type { ResilienceRegistry } from "@vipengele/ts-core-resilience";
import { type OAuth2Options, oauth2Filter, validateOAuth2Options } from "./auth/oauth2-filter";
import { compileChain } from "./chain";
import type { ClientConfig } from "./client-config";
import type { HttpFetch } from "./context";
import { dispatch, resolveFetch } from "./dispatch";
import { HttpConfigError } from "./errors/http-errors";
import type { Filter } from "./filter";
import { createRequestBuilder, type RequestBuilder } from "./request-builder";
import { RESILIENCE_FILTER_NAMES, type ResilienceFilterOptions, resilienceFilters } from "./resilience/resilience-filters";
import { resolveUrl } from "./url";

/** What a client keeps beyond its {@link ClientConfig}, so `extend` can seed a builder from it. */
interface ClientSource {
  readonly baseUrl: URL | undefined;
  readonly headers: Headers;
  readonly filters: readonly Filter[];
  readonly fetch: HttpFetch | undefined;
  readonly throwOnError: boolean;
}

/**
 * An OAuth2 filter added without `authorize`, waiting in the builder's filter list for `build()` to
 * bind it to the `baseUrl` origin. One filter is built per origin and reused by every later build,
 * so the clients a builder builds share one token cache and one in-flight refresh.
 */
class DeferredOAuth2 {
  readonly name = "oauth2";
  readonly #options: OAuth2Options;
  readonly #byOrigin = new Map<string, Filter>();

  constructor(options: OAuth2Options) {
    this.#options = options;
  }

  /** @throws HttpConfigError when `baseUrl` is undefined. */
  bind(baseUrl: URL | undefined): Filter {
    if (baseUrl === undefined) {
      throw new HttpConfigError("oauth2 needs a baseUrl to authorize requests against; set a baseUrl or give authorize");
    }
    const { origin } = baseUrl;
    let bound = this.#byOrigin.get(origin);
    if (bound === undefined) {
      bound = oauth2Filter({ ...this.#options, authorize: (request) => request.url.origin === origin });
      this.#byOrigin.set(origin, bound);
    }
    return bound;
  }
}

/**
 * Collects a client's configuration; `build` turns it into an {@link HttpClient}.
 *
 * Mutable: every method changes the builder and returns it. A built client holds a snapshot, so
 * changing the builder afterwards does not affect it.
 */
export class HttpClientBuilder {
  #baseUrl: URL | undefined;
  #headers: Headers;
  #filters: Array<Filter | DeferredOAuth2>;
  #fetch: HttpFetch | undefined;
  #throwOnError: boolean;

  /** @internal Use {@link HttpClient.builder} or {@link HttpClient.extend}. */
  constructor(source?: ClientSource) {
    this.#baseUrl = source?.baseUrl === undefined ? undefined : new URL(source.baseUrl.href);
    this.#headers = new Headers(source?.headers);
    this.#filters = [...(source?.filters ?? [])];
    this.#fetch = source?.fetch;
    this.#throwOnError = source?.throwOnError ?? false;
  }

  /**
   * Sets the URL relative request paths are joined to.
   *
   * @throws HttpConfigError when `url` is relative, protocol-relative or does not parse.
   */
  baseUrl(url: string | URL): this {
    this.#baseUrl = resolveUrl(url);
    return this;
  }

  /** Sets a header every request starts with, replacing any value of the same name. */
  header(name: string, value: string): this {
    this.#headers.set(name, value);
    return this;
  }

  /** Sets the fetch requests are sent through; without one, the realm's `fetch` is read at each send. */
  fetch(fetch: HttpFetch): this {
    this.#fetch = fetch;
    return this;
  }

  /**
   * Adds filters, left to right. A filter whose name is already present replaces that filter in
   * place, keeping its position in the registration order.
   */
  filter(...filters: Filter[]): this {
    return this.#add(filters);
  }

  #add(filters: ReadonlyArray<Filter | DeferredOAuth2>): this {
    for (const added of filters) {
      const index = this.#filters.findIndex((existing) => existing.name === added.name);
      if (index === -1) {
        this.#filters.push(added);
      } else {
        this.#filters[index] = added;
      }
    }
    return this;
  }

  /**
   * Removes the filter named `name`.
   *
   * @throws HttpConfigError when no filter has that name.
   */
  removeFilter(name: string): this {
    const index = this.#filters.findIndex((existing) => existing.name === name);
    if (index === -1) {
      throw new HttpConfigError(`No filter named "${name}" to remove`);
    }
    this.#filters.splice(index, 1);
    return this;
  }

  /**
   * Replaces the resilience filters with those {@link resilienceFilters} builds from `registry`'s
   * policies called `name`. Every filter named `"retry"`, `"circuit-breaker"`, `"rate-limiter"`,
   * `"timeout"` or `"bulkhead"` is removed first, so a later call replaces the whole set even when it
   * covers other kinds. The set is built before anything is removed: when it throws, the builder is
   * unchanged.
   *
   * @throws HttpConfigError when no kind is configured or created for `name`.
   * @throws ResilienceConfigError, as the registry raises it, for an invalid name, kinds or config.
   */
  resilience(registry: ResilienceRegistry, name: string, options?: ResilienceFilterOptions): this {
    const added = resilienceFilters(registry, name, options);
    this.#filters = this.#filters.filter((existing) => !RESILIENCE_FILTER_NAMES.includes(existing.name));
    return this.filter(...added);
  }

  /**
   * Adds the OAuth2 filter {@link oauth2Filter} builds from `options`, replacing any filter named
   * `"oauth2"`. `options` are validated before the builder changes: when they are invalid, the
   * builder is unchanged.
   *
   * Without `authorize`, only a request whose URL has the `baseUrl`'s origin gets a token, so a
   * request to an absolute URL on another host never carries it. The origin is the `baseUrl` set
   * when {@link build} runs, whether `baseUrl` is called before or after this method; `build` throws
   * when there is none. `authorize: () => true` sends the token with every request.
   *
   * {@link HttpClient.extend} shares the filter instance, so a client and its extension share one
   * token cache and one in-flight refresh. This is intended: both act as the same OAuth2 client. The
   * extension keeps the origin the client was built with, even when it is given another `baseUrl`;
   * calling `oauth2` on it again binds a new filter to the new one.
   *
   * @throws HttpConfigError when `options` are invalid.
   */
  oauth2(options: OAuth2Options): this {
    const { authorize } = options;
    if (authorize === undefined) {
      validateOAuth2Options(options);
      return this.#add([new DeferredOAuth2(options)]);
    }
    return this.filter(oauth2Filter({ ...options, authorize }));
  }

  /** Sets whether `send` raises an `HttpStatusError` for a failing status; off by default. */
  throwOnError(enabled = true): this {
    this.#throwOnError = enabled;
    return this;
  }

  /**
   * Builds the client from a snapshot of this builder.
   *
   * @throws HttpConfigError when filters share an order without every one of them allowing the tie,
   *   or when {@link oauth2} was given no `authorize` and no `baseUrl` is set.
   */
  build(): HttpClient {
    const baseUrl = this.#baseUrl;
    return new HttpClient({
      baseUrl,
      headers: this.#headers,
      filters: this.#filters.map((entry) => (entry instanceof DeferredOAuth2 ? entry.bind(baseUrl) : entry)),
      fetch: this.#fetch,
      throwOnError: this.#throwOnError,
    });
  }
}

/** An HTTP client: a configuration plus a compiled filter chain, producing {@link RequestBuilder}s. */
export class HttpClient {
  readonly #source: ClientSource;
  readonly #config: ClientConfig;

  /** @internal Use {@link HttpClient.builder}. */
  constructor(source: ClientSource) {
    this.#source = {
      baseUrl: source.baseUrl === undefined ? undefined : new URL(source.baseUrl.href),
      headers: new Headers(source.headers),
      filters: [...source.filters],
      fetch: source.fetch,
      throwOnError: source.throwOnError,
    };
    this.#config = {
      baseUrl: this.#source.baseUrl,
      headers: this.#source.headers,
      chain: compileChain(this.#source.filters, dispatch),
      fetch: resolveFetch(this.#source.fetch),
      throwOnError: this.#source.throwOnError,
    };
  }

  /** Starts an empty {@link HttpClientBuilder}. */
  static builder(): HttpClientBuilder {
    return new HttpClientBuilder();
  }

  /** Starts a `GET` request. @throws HttpConfigError when `url` does not resolve. */
  get(url: string | URL): RequestBuilder {
    return this.request("GET", url);
  }

  /** Starts a `POST` request. @throws HttpConfigError when `url` does not resolve. */
  post(url: string | URL): RequestBuilder {
    return this.request("POST", url);
  }

  /** Starts a `PUT` request. @throws HttpConfigError when `url` does not resolve. */
  put(url: string | URL): RequestBuilder {
    return this.request("PUT", url);
  }

  /** Starts a `PATCH` request. @throws HttpConfigError when `url` does not resolve. */
  patch(url: string | URL): RequestBuilder {
    return this.request("PATCH", url);
  }

  /** Starts a `DELETE` request. @throws HttpConfigError when `url` does not resolve. */
  delete(url: string | URL): RequestBuilder {
    return this.request("DELETE", url);
  }

  /** Starts a `HEAD` request. @throws HttpConfigError when `url` does not resolve. */
  head(url: string | URL): RequestBuilder {
    return this.request("HEAD", url);
  }

  /** Starts an `OPTIONS` request. @throws HttpConfigError when `url` does not resolve. */
  options(url: string | URL): RequestBuilder {
    return this.request("OPTIONS", url);
  }

  /**
   * Starts a request with `method` upper-cased.
   *
   * @throws HttpConfigError when `url` is relative and the client has no `baseUrl`, or does not parse.
   */
  request(method: string, url: string | URL): RequestBuilder {
    return createRequestBuilder(this.#config, method, url);
  }

  /** Returns a builder seeded with a copy of this client's configuration; neither affects the other. */
  extend(): HttpClientBuilder {
    return new HttpClientBuilder(this.#source);
  }
}
