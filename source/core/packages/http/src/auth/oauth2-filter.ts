import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import type { HttpContext, HttpRequest } from "../context";
import { HttpConfigError, isOAuth2TokenError, isOAuth2TokenRefusedError, OAuth2TokenError } from "../errors/http-errors";
import { type Filter, filter, Order } from "../filter";
import type { OAuth2Token, OAuth2TokenRequest, OAuth2TokenSource, OAuth2TokenStore } from "./token";

/** Options for {@link oauth2Filter}. */
export type OAuth2FilterOptions = {
  /** Acquires a token whenever the filter holds none it can use. */
  readonly source: OAuth2TokenSource;
  /** Where the token is kept; defaults to an in-memory store belonging to this filter alone. */
  readonly store?: OAuth2TokenStore;
  /** The clock `expiresAt` and the staleness check share; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** The scheduler the refresh deadline waits on; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** How long before `expiresAt` a token counts as stale, at most half its remaining lifetime. Defaults to 30 000 ms. */
  readonly refreshSkewMs?: number;
  /** How long one refresh may take before it is aborted and fails. Defaults to 30 000 ms. */
  readonly refreshTimeoutMs?: number;
  /**
   * Whether `request` gets a token. Required: the filter knows no `baseUrl` to default to, and a
   * filter that authorized every request would send the token to any absolute URL. `() => true`
   * authorizes every request explicitly.
   */
  readonly authorize: (request: HttpRequest) => boolean;
};

/**
 * Options for `HttpClientBuilder.oauth2`: {@link OAuth2FilterOptions} with `authorize` optional.
 * Without one, only a request whose URL has the client's `baseUrl` origin gets a token.
 */
export type OAuth2Options = Omit<OAuth2FilterOptions, "authorize"> & {
  readonly authorize?: OAuth2FilterOptions["authorize"];
};

const DEFAULT_REFRESH_SKEW_MS = 30_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 30_000;

/**
 * The `tokenUrl` of an {@link OAuth2TokenError} the filter raises itself: the filter never sees
 * the URL a source requests, so its errors name the source instead.
 */
const TOKEN_SOURCE_LABEL = "the token source";

/** RFC 6750 section 2.1 `b64token`: the only access tokens sent, so `Headers.set` never throws on one and echoes it. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

function noop(): void {}

const tokenError = (reason: string, options?: ErrorOptions): OAuth2TokenError =>
  new OAuth2TokenError({ tokenUrl: TOKEN_SOURCE_LABEL, reason }, options);

function inMemoryStore(): OAuth2TokenStore {
  let held: OAuth2Token | undefined;
  return {
    get: () => held,
    set: (token) => {
      held = token;
    },
  };
}

/**
 * @internal Checks every option but `authorize`, so the builder can refuse bad options before it
 * knows the `baseUrl` the default `authorize` binds to.
 */
export function validateOAuth2Options(options: OAuth2Options): void {
  const { source, refreshSkewMs, refreshTimeoutMs, authorize } = options;
  if (typeof source?.getToken !== "function") {
    throw new HttpConfigError("oauth2Filter needs a source with a getToken method");
  }
  if (refreshSkewMs !== undefined && !(Number.isFinite(refreshSkewMs) && refreshSkewMs >= 0)) {
    throw new HttpConfigError(`oauth2Filter needs a finite, non-negative refreshSkewMs, got ${String(refreshSkewMs)}`);
  }
  if (refreshTimeoutMs !== undefined && !(Number.isFinite(refreshTimeoutMs) && refreshTimeoutMs > 0)) {
    throw new HttpConfigError(`oauth2Filter needs a finite refreshTimeoutMs above zero, got ${String(refreshTimeoutMs)}`);
  }
  if (authorize !== undefined && typeof authorize !== "function") {
    throw new HttpConfigError("oauth2Filter needs authorize to be a function");
  }
}

/** Sets `Authorization: Bearer` from `token`, failing without the token's value when it is not a `b64token`. */
function setBearer(headers: Headers, token: OAuth2Token): void {
  if (!B64TOKEN.test(token.accessToken)) {
    throw tokenError("the access token is not a valid bearer token");
  }
  headers.set("authorization", `Bearer ${token.accessToken}`);
}

/**
 * Settles with `promise`, or rejects with `signal`'s reason once it aborts, whichever comes first.
 * Abandoning `promise` this way leaves it running.
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * A filter, named `"oauth2"` at {@link Order.AUTH}, that sends `Authorization: Bearer <token>` with
 * every request `authorize` accepts and that does not already carry an `Authorization` header; any
 * other request passes through untouched.
 *
 * **Token.** The filter reads the token from `store` on every request. It uses the held token
 * unless it is stale or is the access token a server last rejected. When it first sees a token it
 * fixes `refreshAt = expiresAt - min(refreshSkewMs, (expiresAt - now) / 2)`, so a short-lived token
 * is not refreshed on every request; a token without `expiresAt` is used until a server rejects it.
 * An access token outside the RFC 6750 `b64token` charset fails with an {@link OAuth2TokenError}
 * that never carries its value.
 *
 * **Refresh.** One refresh runs at a time per filter, and every request needing a token meanwhile
 * waits on it. It calls `source.getToken` with the request's raw `fetch`, so no filter sees the
 * token request, a signal the filter owns, the filter's clock and why a token is wanted, and
 * installs the result with `store.set`. After `refreshTimeoutMs` on `scheduler` the signal is
 * aborted and the refresh fails with an {@link OAuth2TokenError} without a cause. An error from the
 * source that passes `isOAuth2TokenError` or `isOAuth2TokenRefusedError` propagates as it is; any
 * other rejection is wrapped in an {@link OAuth2TokenError} with that cause, and a result without a
 * string `accessToken` fails without one. A waiter whose own request signal aborts rejects with that
 * signal's reason and leaves the refresh running for the rest. A failure is not remembered: the next
 * request starts a new refresh.
 *
 * **401.** A 401 marks its access token as rejected. When the request's body can be sent again, the
 * 401's body is cancelled, a token is obtained as above (refreshing only when the store still holds
 * the rejected access token, compared as a string), and the request is replayed once on a fork of
 * the context with the new header. A 401 to the replay is returned with its body intact. A request
 * whose body can be sent only once is never replayed: its 401 is returned untouched, and the next
 * request refreshes. The store is never cleared; the rejection is remembered by the filter.
 *
 * Every client sharing the filter instance shares its token and its in-flight refresh.
 *
 * @throws HttpConfigError when `source` has no `getToken` method, `refreshSkewMs` is negative or not
 *   finite, `refreshTimeoutMs` is not a finite number above zero, or `authorize` is not a function.
 */
export function oauth2Filter(options: OAuth2FilterOptions): Filter {
  validateOAuth2Options(options);
  if (options.authorize === undefined) {
    throw new HttpConfigError("oauth2Filter needs an authorize function; give () => true to send the token with every request");
  }
  const {
    source,
    store = inMemoryStore(),
    clock = systemClock,
    scheduler = systemScheduler,
    refreshSkewMs = DEFAULT_REFRESH_SKEW_MS,
    refreshTimeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
    authorize,
  } = options;

  /** The access token the filter last saw and when it turns stale. */
  let seen: { readonly accessToken: string; readonly refreshAt: number } | undefined;
  /** The access token a server last answered with a 401. */
  let rejected: string | undefined;
  let inFlight: Promise<OAuth2Token> | undefined;

  function refreshAtOf(token: OAuth2Token): number {
    if (seen?.accessToken !== token.accessToken) {
      const { expiresAt } = token;
      let refreshAt = Number.POSITIVE_INFINITY;
      if (expiresAt !== undefined) {
        const remaining = Math.max(0, expiresAt - clock());
        refreshAt = expiresAt - Math.min(refreshSkewMs, remaining / 2);
      }
      seen = { accessToken: token.accessToken, refreshAt };
    }
    return seen.refreshAt;
  }

  async function obtain(request: OAuth2TokenRequest): Promise<OAuth2Token> {
    let token: OAuth2Token;
    try {
      token = await source.getToken(request);
    } catch (error) {
      if (isOAuth2TokenError(error) || isOAuth2TokenRefusedError(error)) {
        throw error;
      }
      throw tokenError("the token source failed", { cause: error });
    }
    if (typeof token?.accessToken !== "string") {
      throw tokenError("the token source returned no access token");
    }
    return token;
  }

  async function refresh(ctx: HttpContext, reason: OAuth2TokenRequest["reason"]): Promise<OAuth2Token> {
    const controller = new AbortController();
    const timer = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      scheduler.sleep(refreshTimeoutMs, timer.signal).then(() => {
        const error = tokenError("the token refresh timed out");
        controller.abort(error);
        reject(error);
      }, noop);
    });
    try {
      const token = await Promise.race([obtain({ fetch: ctx.fetch, signal: controller.signal, clock, reason }), deadline]);
      if (!B64TOKEN.test(token.accessToken)) {
        throw tokenError("the access token is not a valid bearer token");
      }
      store.set(token);
      rejected = undefined;
      refreshAtOf(token);
      return token;
    } finally {
      timer.abort();
    }
  }

  /** A usable token: the held one, or the result of the one refresh in flight, started when none is. */
  function tokenFor(ctx: HttpContext): Promise<OAuth2Token> {
    const held = store.get();
    if (held !== undefined && held.accessToken !== rejected && clock() < refreshAtOf(held)) {
      return Promise.resolve(held);
    }
    const signal = ctx.request.signal;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (inFlight === undefined) {
      const reason = held === undefined ? "initial" : held.accessToken === rejected ? "rejected" : "expired";
      const started = refresh(ctx, reason).finally(() => {
        inFlight = undefined;
      });
      inFlight = started;
    }
    return raceSignal(inFlight, signal);
  }

  return filter({
    name: "oauth2",
    order: Order.AUTH,
    async handle(ctx, next) {
      if (ctx.request.headers.has("authorization") || !authorize(ctx.request)) {
        return next(ctx);
      }
      const token = await tokenFor(ctx);
      setBearer(ctx.request.headers, token);
      const response = await next(ctx);
      if (response.status !== 401) {
        return response;
      }
      rejected = token.accessToken;
      if (!ctx.replayable) {
        return response;
      }
      response.body?.cancel().catch(noop);
      const fresh = await tokenFor(ctx);
      const fork = ctx.fork();
      setBearer(fork.request.headers, fresh);
      const replayed = await next(fork);
      if (replayed.status === 401) {
        rejected = fresh.accessToken;
      }
      return replayed;
    },
  });
}
