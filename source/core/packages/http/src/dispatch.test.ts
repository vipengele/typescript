import { afterEach, describe, expect, test, vi } from "vitest";
import type { HttpBody } from "./body";
import { createRootContext, type HttpFetch, type HttpRequest } from "./context";
import { dispatch, resolveFetch } from "./dispatch";
import { isHttpConfigError } from "./errors/http-errors";

type Call = { input: string; init: RequestInit & { duplex?: "half" } };

/** A fake fetch that records every call and answers 200. */
function recordingFetch() {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response("ok");
  };
  return { calls, fetch };
}

const makeRequest = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  url: new URL("https://example.com/upload?x=1"),
  method: "POST",
  headers: new Headers({ "x-one": "1" }),
  ...overrides,
});

const bytes = new Uint8Array([1, 2, 3, 4, 5]);

async function* chunks(): AsyncGenerator<Uint8Array> {
  yield bytes.slice(0, 2);
  yield bytes.slice(2);
}

const streamOf = (data: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dispatch", () => {
  test("hands fetch the URL href, method, headers, signal and body", async () => {
    const { calls, fetch } = recordingFetch();
    const signal = new AbortController().signal;
    const request = makeRequest({ body: "payload", signal });

    const response = await dispatch(createRootContext(request, fetch));

    expect(await response.text()).toBe("ok");
    expect(calls).toHaveLength(1);
    const [{ input, init }] = calls as [Call];
    expect(input).toBe("https://example.com/upload?x=1");
    expect(init.method).toBe("POST");
    expect(init.headers).toBe(request.headers);
    expect(init.signal).toBe(signal);
    expect(init.body).toBe("payload");
  });

  test("sets no body or signal key when the request carries neither", async () => {
    const { calls, fetch } = recordingFetch();
    await dispatch(createRootContext(makeRequest({ method: "GET" }), fetch));
    await dispatch(createRootContext(makeRequest({ method: "GET", body: null }), fetch));

    for (const { init } of calls) {
      expect("body" in init).toBe(false);
      expect("signal" in init).toBe(false);
      expect("duplex" in init).toBe(false);
    }
  });

  const replayable: [string, () => HttpBody][] = [
    ["string", () => "text"],
    ["Blob", () => new Blob(["blob"])],
    ["FormData", () => new FormData()],
    ["URLSearchParams", () => new URLSearchParams({ a: "1" })],
    ["ArrayBuffer", () => new ArrayBuffer(4)],
  ];

  test.each(replayable)("passes a %s body as it is with no duplex key, on every dispatch and fork", async (_name, make) => {
    const { calls, fetch } = recordingFetch();
    const body = make();
    const ctx = createRootContext(makeRequest({ body }), fetch);

    await dispatch(ctx);
    await dispatch(ctx);
    await dispatch(ctx.fork());

    expect(calls).toHaveLength(3);
    for (const { init } of calls) {
      expect(init.body).toBe(body);
      expect("duplex" in init).toBe(false);
    }
  });

  test("passes a ReadableStream body as it is, with duplex half", async () => {
    const { calls, fetch } = recordingFetch();
    const body = streamOf(bytes);

    await dispatch(createRootContext(makeRequest({ body }), fetch));

    const [{ init }] = calls as [Call];
    expect(init.body).toBe(body);
    expect(init.duplex).toBe("half");
  });

  test("wraps an async iterable body in a ReadableStream that reads back to its bytes, with duplex half", async () => {
    const { calls, fetch } = recordingFetch();

    await dispatch(createRootContext(makeRequest({ body: chunks() }), fetch));

    const [{ init }] = calls as [Call];
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(init.duplex).toBe("half");
    expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(bytes);
  });

  const oneShot: [string, () => HttpBody][] = [
    ["ReadableStream", () => streamOf(bytes)],
    ["async iterable", () => chunks()],
  ];

  test.each(oneShot)("rejects a second dispatch of the same %s without calling fetch", async (_name, make) => {
    const { calls, fetch } = recordingFetch();
    const ctx = createRootContext(makeRequest({ body: make() }), fetch);

    await dispatch(ctx);
    const error = await dispatch(ctx).catch((e: unknown) => e);

    expect(isHttpConfigError(error)).toBe(true);
    expect((error as Error).message).toContain("cannot be sent twice");
    expect(calls).toHaveLength(1);
  });

  test.each(oneShot)("rejects a fork's dispatch of the %s an earlier attempt sent", async (_name, make) => {
    const { calls, fetch } = recordingFetch();
    const ctx = createRootContext(makeRequest({ body: make() }), fetch);

    await dispatch(ctx);
    const error = await dispatch(ctx.fork()).catch((e: unknown) => e);

    expect(isHttpConfigError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test.each(oneShot)("rejects another call's dispatch of the %s a separate call sent", async (_name, make) => {
    const { calls, fetch } = recordingFetch();
    const body = make();

    await dispatch(createRootContext(makeRequest({ body }), fetch));
    const error = await dispatch(createRootContext(makeRequest({ body }), fetch)).catch((e: unknown) => e);

    expect(isHttpConfigError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("sends a fresh stream a filter puts on a fork after the first was sent", async () => {
    const { calls, fetch } = recordingFetch();
    const ctx = createRootContext(makeRequest({ body: streamOf(bytes) }), fetch);
    await dispatch(ctx);

    const retry = ctx.fork();
    const fresh = streamOf(bytes);
    retry.request.body = fresh;
    await dispatch(retry);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.body).toBe(fresh);
  });

  test("never throws synchronously, even for a body already sent", async () => {
    const { fetch } = recordingFetch();
    const ctx = createRootContext(makeRequest({ body: streamOf(bytes) }), fetch);
    await dispatch(ctx);

    let pending: Promise<Response> | undefined;
    expect(() => {
      pending = dispatch(ctx);
    }).not.toThrow();
    await expect(pending).rejects.toSatisfy(isHttpConfigError);
  });

  test("propagates a network TypeError from fetch unchanged", async () => {
    const failure = new TypeError("Failed to fetch");
    const ctx = createRootContext(makeRequest(), async () => {
      throw failure;
    });

    await expect(dispatch(ctx)).rejects.toBe(failure);
  });

  test("propagates an abort reason from fetch unchanged", async () => {
    const controller = new AbortController();
    const reason = new DOMException("stopped", "AbortError");
    controller.abort(reason);
    const ctx = createRootContext(makeRequest({ signal: controller.signal }), async (_input, init) => {
      throw init.signal?.reason;
    });

    await expect(dispatch(ctx)).rejects.toBe(reason);
  });
});

describe("resolveFetch", () => {
  test("calls an injected fetch as a plain function, with this undefined", async () => {
    const receivers: unknown[] = [];
    const injected: HttpFetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response("ok"));
    };

    const resolved = resolveFetch(injected);
    await resolved("https://example.com/", {});
    await dispatch(createRootContext(makeRequest(), resolved));

    expect(receivers).toEqual([undefined, undefined]);
  });

  test("forwards the input and init to an injected fetch", async () => {
    const { calls, fetch } = recordingFetch();
    const init = { method: "PUT" };

    await resolveFetch(fetch)("https://example.com/x", init);

    expect(calls).toEqual([{ input: "https://example.com/x", init }]);
  });

  test("reads globalThis.fetch when a request is dispatched, not when it is resolved", async () => {
    const resolved = resolveFetch();
    const { calls, fetch } = recordingFetch();
    vi.stubGlobal("fetch", fetch);

    await dispatch(createRootContext(makeRequest(), resolved));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://example.com/upload?x=1");
  });
});
