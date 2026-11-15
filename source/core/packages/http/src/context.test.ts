import { describe, expect, test } from "vitest";
import { createRootContext, type HttpContext, type HttpFetch, type HttpRequest, markSent, wasSent } from "./context";

const stubFetch: HttpFetch = async () => new Response("ok");

const makeRequest = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  url: new URL("https://example.com/a?x=1"),
  method: "POST",
  headers: new Headers({ "x-one": "1" }),
  ...overrides,
});

describe("createRootContext", () => {
  test("starts at attempt 1 with the given request and fetch", () => {
    const request = makeRequest();
    const ctx = createRootContext(request, stubFetch);

    expect(ctx.attempt).toBe(1);
    expect(ctx.request).toBe(request);
    expect(ctx.fetch).toBe(stubFetch);
    expect(ctx.attributes.size).toBe(0);
  });

  test("uses the attributes map it is given", () => {
    const attributes = new Map<string | symbol, unknown>([["k", "v"]]);
    expect(createRootContext(makeRequest(), stubFetch, attributes).attributes).toBe(attributes);
  });
});

describe("replayable", () => {
  test("is true for a string body and false for a stream body", () => {
    expect(createRootContext(makeRequest({ body: "text" }), stubFetch).replayable).toBe(true);
    expect(createRootContext(makeRequest({ body: new ReadableStream() }), stubFetch).replayable).toBe(false);
  });

  test("follows request.body as it changes", () => {
    const ctx = createRootContext(makeRequest({ body: new ReadableStream() }), stubFetch);
    expect(ctx.replayable).toBe(false);

    ctx.request.body = "buffered";
    expect(ctx.replayable).toBe(true);

    ctx.request.body = undefined;
    expect(ctx.replayable).toBe(true);
  });
});

describe("fork", () => {
  test("increments attempt on each fork", () => {
    const root = createRootContext(makeRequest(), stubFetch);
    const second = root.fork();

    expect(second.attempt).toBe(2);
    expect(second.fork().attempt).toBe(3);
    expect(root.attempt).toBe(1);
  });

  test("copies the url and headers so changes to the fork leave the parent alone", () => {
    const root = createRootContext(makeRequest(), stubFetch);
    const fork = root.fork();

    expect(fork.request.url).not.toBe(root.request.url);
    expect(fork.request.url.href).toBe(root.request.url.href);
    expect(fork.request.headers.get("x-one")).toBe("1");

    fork.request.url.searchParams.set("x", "2");
    fork.request.headers.set("x-two", "2");
    fork.request.method = "PUT";
    fork.request.url = new URL("https://other.example/");

    expect(root.request.url.href).toBe("https://example.com/a?x=1");
    expect(root.request.headers.has("x-two")).toBe(false);
    expect(root.request.method).toBe("POST");
  });

  test("keeps the body, signal, fetch and attributes", () => {
    const body = new ReadableStream();
    const signal = new AbortController().signal;
    const root = createRootContext(makeRequest({ body, signal }), stubFetch);
    const fork = root.fork();

    expect(fork.request.body).toBe(body);
    expect(fork.request.signal).toBe(signal);
    expect(fork.fetch).toBe(stubFetch);
    expect(fork.attributes).toBe(root.attributes);

    fork.attributes.set("seen", true);
    expect(root.attributes.get("seen")).toBe(true);
  });

  test("replacing the fork's body leaves the parent's body alone", () => {
    const root = createRootContext(makeRequest({ body: "a" }), stubFetch);
    root.fork().request.body = "b";
    expect(root.request.body).toBe("a");
  });
});

describe("sent-state", () => {
  test("records a sent body for the call", () => {
    const body = new ReadableStream();
    const ctx = createRootContext(makeRequest({ body }), stubFetch);

    expect(wasSent(ctx, body)).toBe(false);
    markSent(ctx, body);
    expect(wasSent(ctx, body)).toBe(true);
  });

  test("is shared by every fork of one call", () => {
    const body = new ReadableStream();
    const root = createRootContext(makeRequest({ body }), stubFetch);
    const fork = root.fork();
    const grandchild = fork.fork();

    markSent(fork, body);

    expect(wasSent(root, body)).toBe(true);
    expect(wasSent(grandchild, body)).toBe(true);
  });

  test("is separate for separate calls", () => {
    const body = new ReadableStream();
    const first = createRootContext(makeRequest({ body }), stubFetch);
    const second = createRootContext(makeRequest({ body }), stubFetch);

    markSent(first, body);

    expect(wasSent(second, body)).toBe(false);
  });

  test("is absent for a context not built by createRootContext", () => {
    const body = new ReadableStream();
    const foreign: HttpContext = {
      request: makeRequest({ body }),
      attributes: new Map(),
      attempt: 1,
      fetch: stubFetch,
      replayable: false,
      fork: () => foreign,
    };

    markSent(foreign, body);

    expect(wasSent(foreign, body)).toBe(false);
  });
});
