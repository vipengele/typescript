import { serializeError } from "@vipengele/ts-core-common/serialization";
import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import { createRetry, fixedBackoff } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { compose } from "../chain";
import { createRootContext, type HttpFetch, type HttpRequest } from "../context";
import { dispatch } from "../dispatch";
import { isHttpConfigError, isOAuth2TokenError, OAuth2TokenError, OAuth2TokenRefusedError } from "../errors/http-errors";
import { type Filter, filter, Order } from "../filter";
import { HttpResilienceAttributes } from "../resilience/predicates";
import { retryFilter } from "../resilience/retry-filter";
import { clientCredentials } from "./client-credentials";
import * as barrel from "./index";
import { type OAuth2FilterOptions, oauth2Filter } from "./oauth2-filter";
import type { OAuth2Token, OAuth2TokenRequest, OAuth2TokenSource, OAuth2TokenStore } from "./token";

const API_URL = "https://api.test/things";
const TOKEN_URL = "https://auth.test/oauth/token";
const START = Date.parse("2040-01-01T00:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Answer = OAuth2Token | Error | (() => Promise<OAuth2Token>);

/** A source answering each request with the next answer, the last one repeating, and recording every request. */
function scriptedSource(...answers: Answer[]): OAuth2TokenSource & { requests: OAuth2TokenRequest[] } {
  const requests: OAuth2TokenRequest[] = [];
  return {
    requests,
    async getToken(request) {
      requests.push(request);
      const answer = answers[Math.min(requests.length, answers.length) - 1] as Answer;
      if (answer instanceof Error) {
        throw answer;
      }
      return typeof answer === "function" ? answer() : answer;
    },
  };
}

type ApiCall = { input: string; init: RequestInit; authorization: string | null };

/** A fetch answering with `reply(call, index)` and recording every call with its Authorization header. */
function api(reply: (call: ApiCall, index: number) => Response = () => new Response("ok")): { fetch: HttpFetch; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  const fetch: HttpFetch = async (input, init) => {
    const call = { input, init, authorization: new Headers(init.headers).get("authorization") };
    calls.push(call);
    return reply(call, calls.length - 1);
  };
  return { fetch, calls };
}

/** Answers 401 to any request carrying `rejected`, 200 otherwise. */
const rejecting =
  (...rejected: string[]) =>
  (call: ApiCall): Response =>
    rejected.some((token) => call.authorization === `Bearer ${token}`) ? new Response("unauthorized", { status: 401 }) : new Response("ok");

function chainOf(fetch: HttpFetch, ...filters: Filter[]) {
  const run = compose(
    [...filters].sort((a, b) => a.order - b.order),
    dispatch,
  );
  return (init: Partial<HttpRequest> = {}): Promise<Response> =>
    run(createRootContext({ url: new URL(API_URL), method: "GET", headers: new Headers(), ...init }, fetch));
}

function setup(answers: Answer[], options: Partial<OAuth2FilterOptions> = {}, reply?: (call: ApiCall, index: number) => Response) {
  const time = createManualTime(START);
  const source = scriptedSource(...answers);
  const { fetch, calls } = api(reply);
  const oauth2 = oauth2Filter({ source, clock: time.clock, scheduler: time.scheduler, ...options });
  return { time, source, calls, oauth2, send: chainOf(fetch, oauth2) };
}

/** Hops real macrotasks until `condition` holds. */
async function until(condition: () => boolean): Promise<void> {
  for (let hops = 0; !condition(); hops++) {
    if (hops > 100) {
      throw new Error("the condition never held");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** A 401 whose body records whether it was cancelled. */
function trackedUnauthorized(): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("denied"));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body, { status: 401 }), cancelled: () => cancelled };
}

const authorizations = (calls: ApiCall[]): Array<string | null> => calls.map((call) => call.authorization);
const reasons = (source: { requests: OAuth2TokenRequest[] }): string[] => source.requests.map((request) => request.reason);

describe("oauth2Filter tokens", () => {
  test("is named oauth2 at Order.AUTH", () => {
    const { oauth2 } = setup([{ accessToken: "a" }]);

    expect(oauth2.name).toBe("oauth2");
    expect(oauth2.order).toBe(Order.AUTH);
  });

  test("fetches a token on the first request, sends it as a bearer header and reuses it", async () => {
    const { send, source, calls, time } = setup([{ accessToken: "first" }]);

    await send();
    await send();

    expect(authorizations(calls)).toEqual(["Bearer first", "Bearer first"]);
    expect(reasons(source)).toEqual(["initial"]);
    const request = source.requests[0] as OAuth2TokenRequest;
    expect(request.clock).toBe(time.clock);
    expect(request.signal.aborted).toBe(false);
    expect(time.pendingSleeps).toBe(0);
  });

  test("refreshes a token refreshSkewMs before it expires", async () => {
    const { send, source, calls, time } = setup([
      { accessToken: "first", expiresAt: START + HOUR },
      { accessToken: "second", expiresAt: START + 2 * HOUR },
    ]);

    await send();
    await time.advance(HOUR - 30_001);
    await send();
    await time.advance(1);
    await send();

    expect(authorizations(calls)).toEqual(["Bearer first", "Bearer first", "Bearer second"]);
    expect(reasons(source)).toEqual(["initial", "expired"]);
  });

  test("clamps the skew to half the remaining lifetime of a short-lived token", async () => {
    const { send, source, calls, time } = setup([{ accessToken: "short", expiresAt: START + 20_000 }, { accessToken: "next" }], {
      refreshSkewMs: 30_000,
    });

    await send();
    await time.advance(9_999);
    await send();
    await time.advance(1);
    await send();

    expect(authorizations(calls)).toEqual(["Bearer short", "Bearer short", "Bearer next"]);
    expect(reasons(source)).toEqual(["initial", "expired"]);
  });

  test("treats a held token already past its expiry as stale", async () => {
    const store = storeHolding({ accessToken: "old", expiresAt: START - 1 });
    const { send, source, calls } = setup([{ accessToken: "new" }], { store });

    await send();

    expect(reasons(source)).toEqual(["expired"]);
    expect(authorizations(calls)).toEqual(["Bearer new"]);
  });

  test("starts one token request for concurrent requests", async () => {
    const pending = deferred<OAuth2Token>();
    const { send, source, calls } = setup([() => pending.promise]);

    const responses = Promise.all([send(), send(), send(), send()]);
    await until(() => source.requests.length === 1);
    pending.resolve({ accessToken: "shared" });
    await responses;

    expect(source.requests).toHaveLength(1);
    expect(authorizations(calls)).toEqual(Array(4).fill("Bearer shared"));
  });

  test("a waiter's abort rejects only that waiter and leaves the refresh running", async () => {
    const pending = deferred<OAuth2Token>();
    const { send, source, calls } = setup([() => pending.promise]);
    const controller = new AbortController();
    const reason = new Error("caller gave up");

    const aborted = send({ signal: controller.signal });
    const kept = send({ signal: new AbortController().signal });
    await until(() => source.requests.length === 1);
    controller.abort(reason);

    await expect(aborted).rejects.toBe(reason);
    expect((source.requests[0] as OAuth2TokenRequest).signal.aborted).toBe(false);
    pending.resolve({ accessToken: "late" });
    await expect(kept).resolves.toBeInstanceOf(Response);
    expect(authorizations(calls)).toEqual(["Bearer late"]);
  });

  test("a request whose signal is already aborted rejects without starting a refresh", async () => {
    const { send, source } = setup([{ accessToken: "a" }]);
    const reason = new Error("already gone");

    await expect(send({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(source.requests).toHaveLength(0);
  });

  test("a hung refresh fails at refreshTimeoutMs with a causeless token error, and the next request refreshes again", async () => {
    const { send, source, time, calls } = setup([() => new Promise<OAuth2Token>(() => {}), { accessToken: "second" }], {
      refreshTimeoutMs: 5_000,
    });

    const hung = failureOf(() => send());
    await until(() => time.pendingSleeps === 1);
    await time.advance(4_999);
    expect(source.requests).toHaveLength(1);
    await time.advance(1);

    const error = await hung;
    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBeUndefined();
    expect((error as OAuth2TokenError).tokenUrl).toBe("the token source");
    expect((source.requests[0] as OAuth2TokenRequest).signal.aborted).toBe(true);

    await send();
    expect(reasons(source)).toEqual(["initial", "initial"]);
    expect(authorizations(calls)).toEqual(["Bearer second"]);
  });

  test("does not remember a failed refresh", async () => {
    const { send, source, calls } = setup([new OAuth2TokenError({ tokenUrl: TOKEN_URL, reason: "down" }), { accessToken: "ok" }]);

    expect(isOAuth2TokenError(await failureOf(() => send({ signal: new AbortController().signal })))).toBe(true);
    await send();

    expect(source.requests).toHaveLength(2);
    expect(authorizations(calls)).toEqual(["Bearer ok"]);
  });

  test("measures the deadline on the system scheduler by default", async () => {
    const source = scriptedSource({ accessToken: "a" });
    const { fetch, calls } = api();

    await chainOf(fetch, oauth2Filter({ source }))();

    expect(authorizations(calls)).toEqual(["Bearer a"]);
  });
});

describe("oauth2Filter 401", () => {
  test("cancels the 401 body, refreshes with reason rejected and replays once with the new header", async () => {
    const first = trackedUnauthorized();
    const { send, source, calls } = setup([{ accessToken: "old" }, { accessToken: "new" }], {}, (call) =>
      call.authorization === "Bearer old" ? first.response : new Response("ok"),
    );

    const response = await send();

    expect(response.status).toBe(200);
    expect(first.cancelled()).toBe(true);
    expect(reasons(source)).toEqual(["initial", "rejected"]);
    expect(authorizations(calls)).toEqual(["Bearer old", "Bearer new"]);
  });

  test("replays a 401 with no body", async () => {
    const { send, calls } = setup([{ accessToken: "old" }, { accessToken: "new" }], {}, (call) =>
      call.authorization === "Bearer old" ? new Response(null, { status: 401 }) : new Response("ok"),
    );

    expect((await send()).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("returns a second 401 with its body intact and refreshes on the next request", async () => {
    const { send, source, calls } = setup([{ accessToken: "a" }, { accessToken: "b" }, { accessToken: "c" }], {}, rejecting("a", "b"));

    const response = await send();

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer b"]);

    expect((await send()).status).toBe(200);
    expect(reasons(source)).toEqual(["initial", "rejected", "rejected"]);
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer b", "Bearer c"]);
  });

  test("propagates the typed error of a refresh that fails after a 401", async () => {
    const refused = new OAuth2TokenRefusedError({ tokenUrl: TOKEN_URL, status: 400, error: "invalid_client" });
    const { send, calls } = setup([{ accessToken: "a" }, refused], {}, rejecting("a"));

    expect(await failureOf(() => send())).toBe(refused);
    expect(calls).toHaveLength(1);
  });

  test.each([
    ["the same object", (token: OAuth2Token) => token],
    ["fresh copies", (token: OAuth2Token) => ({ ...token })],
  ])("replays without refreshing when the store already holds a different token, returning %s", async (_name, copy) => {
    let held: OAuth2Token | undefined;
    const store: OAuth2TokenStore = {
      get: () => (held === undefined ? undefined : copy(held)),
      set: (token) => {
        held = token;
      },
    };
    const { send, source, calls } = setup([{ accessToken: "a" }], { store }, (call, index) => {
      if (index === 0) {
        held = { accessToken: "rotated" };
      }
      return rejecting("a")(call);
    });

    expect((await send()).status).toBe(200);
    expect(reasons(source)).toEqual(["initial"]);
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer rotated"]);
    await send();
    expect(source.requests).toHaveLength(1);
  });

  test("refreshes once for concurrent 401s", async () => {
    const second = deferred<OAuth2Token>();
    const store = storeHolding({ accessToken: "a" });
    const { send, source, calls } = setup([() => second.promise], { store }, rejecting("a"));

    const responses = Promise.all([send(), send(), send()]);
    await until(() => source.requests.length === 1 && calls.length === 3);
    second.resolve({ accessToken: "b" });
    const statuses = (await responses).map((response) => response.status);

    expect(statuses).toEqual([200, 200, 200]);
    expect(reasons(source)).toEqual(["rejected"]);
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer a", "Bearer a", "Bearer b", "Bearer b", "Bearer b"]);
  });

  test("a non-replayable 401 is returned untouched, the store is kept, and the next request refreshes with reason rejected", async () => {
    const store = storeHolding(undefined);
    const { send, source, calls } = setup([{ accessToken: "a" }, { accessToken: "b" }], { store }, rejecting("a"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const response = await send({ method: "POST", body });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("unauthorized");
    expect(calls).toHaveLength(1);
    expect(reasons(source)).toEqual(["initial"]);
    expect(store.get()).toEqual({ accessToken: "a" });

    await send();
    expect(reasons(source)).toEqual(["initial", "rejected"]);
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer b"]);
  });
});

describe("oauth2Filter pass-through", () => {
  test("passes a request authorize declines through untouched", async () => {
    const seen: HttpRequest[] = [];
    const { send, source, calls } = setup([{ accessToken: "a" }], {
      authorize: (request) => {
        seen.push(request);
        return request.url.origin === "https://other.test";
      },
    });

    await send();

    expect(seen).toHaveLength(1);
    expect(calls[0]?.authorization).toBeNull();
    expect(source.requests).toHaveLength(0);
  });

  test("passes a request carrying its own Authorization through untouched, even on a 401", async () => {
    const { send, source, calls } = setup([{ accessToken: "a" }], {}, () => new Response("no", { status: 401 }));

    const response = await send({ headers: new Headers({ Authorization: "Basic abc" }) });

    expect(response.status).toBe(401);
    expect(authorizations(calls)).toEqual(["Basic abc"]);
    expect(source.requests).toHaveLength(0);
  });
});

describe("oauth2Filter custom sources", () => {
  test.each([
    ["a token error", new OAuth2TokenError({ tokenUrl: TOKEN_URL, reason: "down" })],
    ["a refusal", new OAuth2TokenRefusedError({ tokenUrl: TOKEN_URL, status: 401 })],
  ])("propagates %s as it is", async (_name, thrown) => {
    const { send } = setup([thrown]);

    expect(await failureOf(() => send())).toBe(thrown);
  });

  test("wraps any other rejection in a token error with that cause", async () => {
    const thrown = new TypeError("vault unreachable");
    const { send } = setup([thrown]);

    const error = await failureOf(() => send());

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBe(thrown);
  });

  test("wraps a synchronous throw from getToken", async () => {
    const thrown = new Error("sync");
    const source: OAuth2TokenSource = {
      getToken() {
        throw thrown;
      },
    };
    const { fetch } = api();
    const time = createManualTime(START);

    const error = await failureOf(() => chainOf(fetch, oauth2Filter({ source, clock: time.clock, scheduler: time.scheduler }))());

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBe(thrown);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an object without accessToken", { token: "a" }],
    ["a non-string accessToken", { accessToken: 42 }],
  ])("fails with a causeless token error on a result that is %s", async (_name, result) => {
    const { send } = setup([() => Promise.resolve(result as unknown as OAuth2Token)]);

    const error = await failureOf(() => send());

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBeUndefined();
  });

  test.each([
    ["holds a space", "abc def"],
    ["holds a newline", "abc\ndef"],
    ["is empty", ""],
    ["has padding inside", "ab=cd"],
  ])("fails without leaking an access token that %s, and stores nothing", async (_name, accessToken) => {
    const store = storeHolding(undefined);
    const { send, calls } = setup([{ accessToken }], { store });

    const error = await failureOf(() => send());

    expect(isOAuth2TokenError(error)).toBe(true);
    expect((error as Error).cause).toBeUndefined();
    if (accessToken !== "") {
      expect(JSON.stringify(serializeError(error))).not.toContain(accessToken);
    }
    expect(store.get()).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("fails without leaking an invalid access token a shared store holds", async () => {
    const secret = "in valid";
    const { send, source, calls } = setup([{ accessToken: "unused" }], { store: storeHolding({ accessToken: secret }) });

    const error = await failureOf(() => send());

    expect(isOAuth2TokenError(error)).toBe(true);
    expect(JSON.stringify(serializeError(error))).not.toContain(secret);
    expect(source.requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("accepts every b64token character and trailing padding", async () => {
    const accessToken = "AZaz09-._~+/==";
    const { send, calls } = setup([{ accessToken }]);

    await send();

    expect(authorizations(calls)).toEqual([`Bearer ${accessToken}`]);
  });
});

describe("oauth2Filter composition", () => {
  test("sends the token request through the raw fetch, past every downstream filter", async () => {
    const time = createManualTime(START);
    const seen: string[] = [];
    const downstream = filter({
      name: "spy",
      order: Order.ATTEMPT,
      handle: (ctx, next) => {
        seen.push(ctx.request.url.href);
        return next();
      },
    });
    const { fetch, calls } = api((call) =>
      call.input === TOKEN_URL
        ? new Response(JSON.stringify({ access_token: "issued", token_type: "Bearer" }), {
            headers: { "content-type": "application/json" },
          })
        : new Response("ok"),
    );
    const source = clientCredentials({ tokenUrl: TOKEN_URL, clientId: "id", clientSecret: "secret" });

    await chainOf(fetch, oauth2Filter({ source, clock: time.clock, scheduler: time.scheduler }), downstream)();

    expect(seen).toEqual([API_URL]);
    expect(calls.map((call) => call.input)).toEqual([TOKEN_URL, API_URL]);
    expect(calls[1]?.authorization).toBe("Bearer issued");
  });

  test("a replay re-enters the retry filter with a fresh budget", async () => {
    const time = createManualTime(START);
    const retryTime: ManualTime = createManualTime(START);
    const retry = retryFilter(createRetry("http", { maxAttempts: 2, backoff: fixedBackoff(100) }, retryTime));
    const source = scriptedSource({ accessToken: "a" }, { accessToken: "b" });
    const statuses = [503, 401, 503, 200];
    const { fetch, calls } = api((_call, index) => new Response(`body ${index}`, { status: statuses[index] }));
    const run = compose([oauth2Filter({ source, clock: time.clock, scheduler: time.scheduler }), retry], dispatch);
    const attributes = new Map<string | symbol, unknown>();

    const pending = run(createRootContext({ url: new URL(API_URL), method: "GET", headers: new Headers() }, fetch, attributes));
    for (let wait = 0; wait < 2; wait++) {
      await until(() => retryTime.pendingSleeps === 1);
      await retryTime.advance(100);
    }
    const response = await pending;

    expect(response.status).toBe(200);
    expect(authorizations(calls)).toEqual(["Bearer a", "Bearer a", "Bearer b", "Bearer b"]);
    expect(attributes.get(HttpResilienceAttributes.attempts)).toBe(2);
  });
});

describe("oauth2Filter options", () => {
  test.each([
    ["a missing source", { source: undefined }],
    ["a source without getToken", { source: {} }],
    ["a negative refreshSkewMs", { refreshSkewMs: -1 }],
    ["a non-finite refreshSkewMs", { refreshSkewMs: Number.POSITIVE_INFINITY }],
    ["a NaN refreshSkewMs", { refreshSkewMs: Number.NaN }],
    ["a zero refreshTimeoutMs", { refreshTimeoutMs: 0 }],
    ["a negative refreshTimeoutMs", { refreshTimeoutMs: -5 }],
    ["a non-finite refreshTimeoutMs", { refreshTimeoutMs: Number.POSITIVE_INFINITY }],
  ])("rejects %s with an HttpConfigError", (_name, overrides) => {
    const options = { source: scriptedSource({ accessToken: "a" }), ...overrides } as OAuth2FilterOptions;

    let error: unknown;
    try {
      oauth2Filter(options);
    } catch (thrown) {
      error = thrown;
    }

    expect(isHttpConfigError(error)).toBe(true);
  });

  test("accepts a zero refreshSkewMs", async () => {
    const { send, source, time } = setup([{ accessToken: "a", expiresAt: START + 1_000 }, { accessToken: "b" }], { refreshSkewMs: 0 });

    await send();
    await time.advance(999);
    await send();
    await time.advance(1);
    await send();

    expect(reasons(source)).toEqual(["initial", "expired"]);
  });

  test("the barrel exports oauth2Filter", () => {
    expect(barrel.oauth2Filter).toBe(oauth2Filter);
  });
});

function storeHolding(token: OAuth2Token | undefined): OAuth2TokenStore {
  let held = token;
  return {
    get: () => held,
    set: (next) => {
      held = next;
    },
  };
}
