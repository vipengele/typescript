import { describe, expect, test, vi } from "vitest";
import { compileChain } from "./chain";
import type { ClientConfig } from "./client-config";
import type { HttpContext, HttpFetch } from "./context";
import { dispatch, resolveFetch } from "./dispatch";
import { isHttpConfigError, isHttpStatusError } from "./errors/http-errors";
import { type Filter, filter } from "./filter";
import { createRequestBuilder, type RequestBuilder } from "./request-builder";

type Call = { input: string; init: RequestInit };

type Responder = (input: string, init: RequestInit) => Response;

/** A fake fetch that records every call, rejects with the signal's reason when aborted like `fetch`, and answers through `respond`. */
function fakeFetch(respond: Responder = () => new Response("ok")) {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (input, init) => {
    calls.push({ input, init });
    if (init.signal?.aborted) {
      throw init.signal.reason;
    }
    return respond(input, init);
  };
  return { calls, fetch };
}

type Setup = {
  respond?: Responder;
  headers?: HeadersInit;
  baseUrl?: string;
  throwOnError?: boolean;
  filters?: Filter[];
};

function setup({ respond, headers, baseUrl = "https://h.test/api", throwOnError = false, filters = [] }: Setup = {}) {
  const fake = fakeFetch(respond);
  const config: ClientConfig = {
    baseUrl: new URL(baseUrl),
    headers: new Headers(headers),
    chain: compileChain(filters, dispatch),
    fetch: resolveFetch(fake.fetch),
    throwOnError,
  };
  const call = (index = 0): Call => fake.calls[index] as Call;
  const sentHeaders = (index = 0): Headers => call(index).init.headers as Headers;
  return { config, calls: fake.calls, call, sentHeaders, get: (url = "/x") => createRequestBuilder(config, "get", url) };
}

/** A filter that hands each context it sees to `seen`. */
function capture(seen: HttpContext[]): Filter {
  return filter({
    name: "capture",
    order: 100,
    handle: (ctx, next) => {
      seen.push(ctx);
      return next();
    },
  });
}

describe("createRequestBuilder", () => {
  test("upper-cases the method", async () => {
    const { config, call } = setup();
    await createRequestBuilder(config, "patch", "/x").send();
    expect(call().init.method).toBe("PATCH");
  });

  test("resolves a relative path against the base URL", async () => {
    const { get, call } = setup();
    await get("users/1").send();
    expect(call().input).toBe("https://h.test/api/users/1");
  });

  test("throws HttpConfigError at creation for a relative path without a base URL", () => {
    const { config } = setup();
    const { baseUrl: _, ...rest } = config;
    expect(() => createRequestBuilder(rest, "GET", "/x")).toThrow(expect.objectContaining({ code: "http.config" }));
  });
});

describe("immutability", () => {
  test("every setter leaves the original builder unchanged", async () => {
    const seen: HttpContext[] = [];
    const { get, calls } = setup({ filters: [capture(seen)] });
    const original = get();
    const changed = [
      original.header("x-a", "1"),
      original.query("q", 1),
      original.json({ a: 1 }),
      original.body("raw"),
      original.signal(new AbortController().signal),
      original.attribute("k", "v"),
    ];
    expect(changed.every((builder) => builder !== original)).toBe(true);

    await original.send();

    const [{ input, init }] = calls as [Call];
    expect(input).toBe("https://h.test/api/x");
    expect([...(init.headers as Headers)]).toEqual([]);
    expect("body" in init).toBe(false);
    expect("signal" in init).toBe(false);
    expect((seen[0] as HttpContext).attributes.size).toBe(0);
  });

  test("each send gets its own attributes map, URL and headers", async () => {
    const seen: HttpContext[] = [];
    const { get } = setup({ filters: [capture(seen)] });
    const builder = get().attribute("k", 1).header("x-a", "1");

    await builder.send();
    await builder.send();

    const [first, second] = seen as [HttpContext, HttpContext];
    expect(first.attributes).not.toBe(second.attributes);
    expect(first.request.url).not.toBe(second.request.url);
    expect(first.request.headers).not.toBe(second.request.headers);
    expect(second.attributes.get("k")).toBe(1);
  });

  test("is not thenable", async () => {
    const builder = setup().get();
    expect("then" in builder).toBe(false);
    expect(await builder).toBe(builder);
  });
});

describe("headers", () => {
  test("request headers win over client headers, and client-only headers are sent", async () => {
    const { get, sentHeaders } = setup({ headers: { "x-shared": "client", "x-client": "c" } });
    await get().header("x-shared", "request").header("x-request", "r").send();

    const headers = sentHeaders();
    expect(headers.get("x-shared")).toBe("request");
    expect(headers.get("x-client")).toBe("c");
    expect(headers.get("x-request")).toBe("r");
  });

  test("header replaces an earlier value of the same name", async () => {
    const { get, sentHeaders } = setup();
    await get().header("x-a", "1").header("X-A", "2").send();
    expect(sentHeaders().get("x-a")).toBe("2");
  });

  test("leaves the client headers untouched", async () => {
    const { config, get } = setup({ headers: { "x-client": "c" } });
    await get().header("x-client", "r").json({ a: 1 }).send();
    expect([...config.headers]).toEqual([["x-client", "c"]]);
  });
});

describe("query", () => {
  test("appends to a query the path already carries, stringifying the value", async () => {
    const { get, call } = setup();
    await get("/x?a=1").query("a", 2).query("n", 3).query("b", true).send();
    const url = new URL(call().input);
    expect(url.pathname).toBe("/api/x");
    expect([...url.searchParams]).toEqual([
      ["a", "1"],
      ["a", "2"],
      ["n", "3"],
      ["b", "true"],
    ]);
  });
});

describe("request body", () => {
  test("json(body) sends the serialized body with content-type application/json", async () => {
    const { get, call, sentHeaders } = setup();
    await get()
      .json({ a: [1, "b"] })
      .send();
    expect(call().init.body).toBe('{"a":[1,"b"]}');
    expect(sentHeaders().get("content-type")).toBe("application/json");
  });

  test("json(null) sends null as JSON", async () => {
    const { get, call } = setup();
    await get().json(null).send();
    expect(call().init.body).toBe("null");
  });

  test("an explicit content-type is never overwritten by json(body)", async () => {
    const { get, sentHeaders } = setup();
    await get().header("content-type", "application/vnd.x+json").json({ a: 1 }).send();
    await get().json({ a: 1 }).header("content-type", "text/plain").send();
    expect(sentHeaders(0).get("content-type")).toBe("application/vnd.x+json");
    expect(sentHeaders(1).get("content-type")).toBe("text/plain");
  });

  test("a client content-type is kept over the JSON default", async () => {
    const { get, sentHeaders } = setup({ headers: { "content-type": "application/ld+json" } });
    await get().json({ a: 1 }).send();
    expect(sentHeaders().get("content-type")).toBe("application/ld+json");
  });

  test("body() after json() sends the raw body with no automatic content-type", async () => {
    const { get, call, sentHeaders } = setup();
    await get().json({ a: 1 }).body("raw").send();
    expect(call().init.body).toBe("raw");
    expect(sentHeaders().has("content-type")).toBe(false);
  });

  test("json() after body() sends the JSON body with content-type", async () => {
    const { get, call, sentHeaders } = setup();
    await get().body("raw").json([1]).send();
    expect(call().init.body).toBe("[1]");
    expect(sentHeaders().get("content-type")).toBe("application/json");
  });

  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const oneShot: [string, () => ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>][] = [
    [
      "async generator",
      () =>
        (async function* () {
          yield payload.slice(0, 2);
          yield payload.slice(2);
        })(),
    ],
    [
      "ReadableStream",
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(payload.slice());
            controller.close();
          },
        }),
    ],
  ];

  test.each(oneShot)("a second terminal call with the same %s body rejects with HttpConfigError without calling fetch", async (_, make) => {
    const { get, calls, call } = setup();
    const builder = get().body(make());

    await builder.send();
    expect(new Uint8Array(await new Response(call().init.body).arrayBuffer())).toEqual(payload);

    const error = await builder.send().catch((e: unknown) => e);
    expect(isHttpConfigError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test.each(oneShot)("a derived builder reusing a sent %s body is refused", async (_, make) => {
    const { get, calls } = setup();
    const builder = get().body(make());

    await builder.send();
    const error = await builder
      .header("x-retry", "1")
      .send()
      .catch((e: unknown) => e);

    expect(isHttpConfigError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("json(undefined) throws HttpConfigError synchronously", () => {
    const builder = setup().get();
    let thrown: unknown;
    try {
      builder.json(undefined);
    } catch (error) {
      thrown = error;
    }
    expect(isHttpConfigError(thrown)).toBe(true);
  });

  test.each([
    [
      "a cycle",
      () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      },
    ],
    ["a BigInt", () => ({ n: 1n })],
  ])("json(body) with %s throws HttpConfigError synchronously with the cause", (_, make) => {
    const builder = setup().get();
    let thrown: unknown;
    try {
      builder.json(make());
    } catch (error) {
      thrown = error;
    }
    expect(isHttpConfigError(thrown)).toBe(true);
    expect((thrown as Error).cause).toBeInstanceOf(TypeError);
  });
});

describe("accept", () => {
  test("json<T>() sets accept application/json when absent", async () => {
    const { get, sentHeaders } = setup({ respond: () => new Response("{}") });
    await get().json();
    expect(sentHeaders().get("accept")).toBe("application/json");
  });

  test("json<T>() keeps an accept the request or the client sets", async () => {
    const { get, sentHeaders } = setup({ headers: { accept: "application/vnd.c+json" }, respond: () => new Response("{}") });
    await get().json();
    await get().header("accept", "application/vnd.r+json").json();
    expect(sentHeaders(0).get("accept")).toBe("application/vnd.c+json");
    expect(sentHeaders(1).get("accept")).toBe("application/vnd.r+json");
  });

  test.each(["send", "exchange", "text", "void"] as const)("%s() sets no accept", async (terminal) => {
    const { get, sentHeaders } = setup();
    await get()[terminal]();
    expect(sentHeaders().has("accept")).toBe(false);
  });
});

describe("attributes and signal", () => {
  test("a filter sees the attributes and the signal", async () => {
    const seen: HttpContext[] = [];
    const { get } = setup({ filters: [capture(seen)] });
    const signal = new AbortController().signal;
    const key = Symbol("k");

    await get().attribute("a", 1).attribute(key, "s").signal(signal).send();

    const [ctx] = seen as [HttpContext];
    expect(ctx.attributes.get("a")).toBe(1);
    expect(ctx.attributes.get(key)).toBe("s");
    expect(ctx.request.signal).toBe(signal);
    expect(ctx.attempt).toBe(1);
  });

  test.each(["send", "exchange"] as const)("an aborted signal rejects %s() with the signal's reason", async (terminal) => {
    const { get } = setup();
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(get().signal(controller.signal)[terminal]()).rejects.toBe(reason);
  });

  test.each(["send", "exchange"] as const)("a network rejection rejects %s() with the same error", async (terminal) => {
    const failure = new TypeError("network down");
    const { get } = setup({
      respond: () => {
        throw failure;
      },
    });
    await expect(get()[terminal]()).rejects.toBe(failure);
  });
});

describe("terminal status matrix", () => {
  const terminals = ["send", "exchange", "json", "text", "void"] as const;
  type Terminal = (typeof terminals)[number];
  const cases = terminals.flatMap((terminal) =>
    [false, true].flatMap((throwOnError) => [200, 404, 500].map((status) => ({ terminal, throwOnError, status }))),
  );

  /** Whether `terminal` rejects on a failing status under `throwOnError`. */
  const rejectsOnStatus = (terminal: Terminal, throwOnError: boolean) => terminal !== "exchange" && (terminal !== "send" || throwOnError);

  test.each(cases)("$terminal with throwOnError $throwOnError on $status", async ({ terminal, throwOnError, status }) => {
    let produced: Response | undefined;
    const { get } = setup({
      throwOnError,
      respond: () => {
        produced = new Response('{"v":1}', { status });
        return produced;
      },
    });
    const run: Record<Terminal, (builder: RequestBuilder) => Promise<unknown>> = {
      send: (builder) => builder.send(),
      exchange: (builder) => builder.exchange(),
      json: (builder) => builder.json(),
      text: (builder) => builder.text(),
      void: (builder) => builder.void(),
    };
    const outcome = run[terminal](get()).then(
      (value: unknown) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const settled = (await outcome) as { value?: unknown; error?: unknown };

    if (status >= 400 && rejectsOnStatus(terminal, throwOnError)) {
      expect(isHttpStatusError(settled.error)).toBe(true);
      const error = settled.error as { status: number; method: string; url: string; response: Response };
      expect(error.status).toBe(status);
      expect(error.method).toBe("GET");
      expect(error.url).toBe("https://h.test/api/x");
      expect(error.response).toBe(produced);
      expect(error.response.bodyUsed).toBe(false);
      expect(await error.response.text()).toBe('{"v":1}');
      return;
    }
    expect(settled.error).toBeUndefined();
    const expected: Record<Terminal, (value: unknown) => Promise<void> | void> = {
      send: (value) => expect(value).toBe(produced),
      exchange: (value) => expect((value as { raw: Response }).raw).toBe(produced),
      json: (value) => expect(value).toEqual({ v: 1 }),
      text: (value) => expect(value).toBe('{"v":1}'),
      void: (value) => expect(value).toBeUndefined(),
    };
    await expected[terminal](settled.value);
  });

  test("the status error carries the URL and method of the request as the chain left it", async () => {
    const rewrite = filter({
      name: "rewrite",
      order: 100,
      handle: (ctx, next) => {
        ctx.request.url.pathname = "/moved";
        return next();
      },
    });
    const { get } = setup({ filters: [rewrite], respond: () => new Response(null, { status: 503 }) });
    await expect(get().text()).rejects.toMatchObject({ url: "https://h.test/moved", method: "GET", status: 503 });
  });

  test("the status error carries the URL and method of the forked request that produced the response", async () => {
    const forkTo = filter({
      name: "fork-to",
      order: 100,
      handle: (ctx, next) => {
        const forked = ctx.fork();
        forked.request.url.pathname = "/elsewhere";
        forked.request.method = "PUT";
        return next(forked);
      },
    });
    const respond = () => new Response("missing", { status: 404 });
    const { get } = setup({ filters: [forkTo], respond });
    const reported = { url: "https://h.test/elsewhere", method: "PUT", status: 404 };
    await expect(get().json()).rejects.toMatchObject(reported);
    await expect(get().text()).rejects.toMatchObject(reported);
    await expect(get().void()).rejects.toMatchObject(reported);
    const throwing = setup({ filters: [forkTo], respond, throwOnError: true });
    await expect(throwing.get().send()).rejects.toMatchObject(reported);
  });

  test("the status error carries the root request when a filter answers without dispatching", async () => {
    const answer = filter({
      name: "answer",
      order: 100,
      handle: () => Promise.resolve(new Response(null, { status: 410 })),
    });
    const { get, calls } = setup({ filters: [answer] });
    await expect(get().text()).rejects.toMatchObject({ url: "https://h.test/api/x", method: "GET", status: 410 });
    expect(calls).toHaveLength(0);
  });
});

describe("json<T>() decoding", () => {
  test.each([
    ["204", "GET", () => new Response(null, { status: 204 })],
    ["205", "GET", () => new Response(null, { status: 205 })],
    ["HEAD", "HEAD", () => new Response("ignored")],
    ["an empty 200", "GET", () => new Response("")],
  ])("resolves undefined for %s", async (_, method, respond) => {
    const { config } = setup({ respond });
    await expect(createRequestBuilder(config, method, "/x").json()).resolves.toBeUndefined();
  });

  test("applies the HEAD rule to the method a forked request was dispatched with", async () => {
    const asHead = filter({
      name: "as-head",
      order: 100,
      handle: (ctx, next) => {
        const forked = ctx.fork();
        forked.request.method = "HEAD";
        return next(forked);
      },
    });
    const { get } = setup({ filters: [asHead], respond: () => new Response('{"a":1}') });
    await expect(get().json()).resolves.toBeUndefined();
    await expect((await get().exchange()).json()).resolves.toBeUndefined();
  });

  test("rejects invalid JSON with the parser's SyntaxError", async () => {
    const { get } = setup({ respond: () => new Response("{not json") });
    await expect(get().json()).rejects.toBeInstanceOf(SyntaxError);
  });

  test("resolves the parsed body typed as T", async () => {
    const { get } = setup({ respond: () => new Response('{"id":7}') });
    const value = await get().json<{ id: number }>();
    expect(value.id).toBe(7);
  });
});

describe("exchange()", () => {
  test("exposes the status, headers and raw response", async () => {
    let produced: Response | undefined;
    const { get } = setup({
      respond: () => {
        produced = new Response("{}", { status: 404, statusText: "Not Found", headers: { "x-r": "1" } });
        return produced;
      },
    });
    const response = await get().exchange();
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(response.statusText).toBe("Not Found");
    expect(response.headers.get("x-r")).toBe("1");
    expect(response.url).toBe("");
    expect(response.raw).toBe(produced);
  });

  test("json() parses the body and follows the empty-body rule", async () => {
    const parsed = await (
      await setup({ respond: () => new Response('{"a":1}') })
        .get()
        .exchange()
    ).json();
    expect(parsed).toEqual({ a: 1 });
    const empty = await (
      await setup({ respond: () => new Response(null, { status: 204 }) })
        .get()
        .exchange()
    ).json();
    expect(empty).toBeUndefined();
  });

  test("text() reads the body", async () => {
    const response = await setup({ respond: () => new Response("hello") })
      .get()
      .exchange();
    expect(await response.text()).toBe("hello");
  });

  test("discard() cancels the body, and resolves when there is none", async () => {
    const withBody = await setup({ respond: () => new Response("x") })
      .get()
      .exchange();
    const cancel = vi.spyOn(withBody.raw.body as ReadableStream, "cancel");
    await withBody.discard();
    expect(cancel).toHaveBeenCalledOnce();

    const withoutBody = await setup({ respond: () => new Response(null, { status: 204 }) })
      .get()
      .exchange();
    await expect(withoutBody.discard()).resolves.toBeUndefined();
  });
});

describe("void()", () => {
  test("cancels the body on success", async () => {
    let cancel: ReturnType<typeof vi.spyOn> | undefined;
    const { get } = setup({
      respond: () => {
        const response = new Response("x");
        cancel = vi.spyOn(response.body as ReadableStream, "cancel");
        return response;
      },
    });
    await get().void();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("resolves for a response without a body", async () => {
    const { get } = setup({ respond: () => new Response(null, { status: 204 }) });
    await expect(get().void()).resolves.toBeUndefined();
  });
});
