import type { ResilienceRegistry } from "@vipengele/ts-core-resilience";
import { type OAuth2FilterOptions, oauth2Filter } from "./auth/oauth2-filter";
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
 * Collects a client's configuration; `build` turns it into an {@link HttpClient}.
 *
 * Mutable: every method changes the builder and returns it. A built client holds a snapshot, so
 * changing the builder afterwards does not affect it.
 */
export class HttpClientBuilder {
  #baseUrl: URL | undefined;
  #headers: Headers;
  #filters: Filter[];
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
   * `"oauth2"`. The filter is built before the builder changes: when `options` are invalid, the
   * builder is unchanged.
   *
   * {@link HttpClient.extend} shares the filter instance, so a client and its extension share one
   * token cache and one in-flight refresh. This is intended: both act as the same OAuth2 client.
   *
   * @throws HttpConfigError when `options` are invalid.
   */
  oauth2(options: OAuth2FilterOptions): this {
    return this.filter(oauth2Filter(options));
  }

  /** Sets whether `send` raises an `HttpStatusError` for a failing status; off by default. */
  throwOnError(enabled = true): this {
    this.#throwOnError = enabled;
    return this;
  }

  /**
   * Builds the client from a snapshot of this builder.
   *
   * @throws HttpConfigError when filters share an order without every one of them allowing the tie.
   */
  build(): HttpClient {
    return new HttpClient({
      baseUrl: this.#baseUrl,
      headers: this.#headers,
      filters: this.#filters,
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
