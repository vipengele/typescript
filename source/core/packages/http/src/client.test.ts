import { createRegistry, fixedBackoff, isBulkheadFullError, type ResilienceRegistry } from "@vipengele/ts-core-resilience";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "./client";
import type { HttpFetch } from "./context";
import { isHttpConfigError, isHttpStatusError } from "./errors/http-errors";
import { type Filter, filter, Order } from "./filter";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(status = 200, body: BodyInit | null = "ok"): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 204 || status === 205 ? null : body, { status });
  };
  return { fetch, calls };
}

function recorder(name: string, order: number, log: string[]): Filter {
  return filter({
    name,
    order,
    handle: (_ctx, next) => {
      log.push(name);
      return next();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpClient verbs", () => {
  it.each([
    ["get", "GET"],
    ["post", "POST"],
    ["put", "PUT"],
    ["patch", "PATCH"],
    ["delete", "DELETE"],
    ["head", "HEAD"],
    ["options", "OPTIONS"],
  ] as const)("%s sends %s", async (verb, method) => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().fetch(fetch).build();
    await client[verb]("https://h.test/x").send();
    expect(calls[0]?.init.method).toBe(method);
  });

  it("upper-cases the method given to request", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().fetch(fetch).build();
    await client.request("patch", "https://h.test/x").send();
    expect(calls[0]?.init.method).toBe("PATCH");
  });

  it("accepts a URL object", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().fetch(fetch).build();
    await client.get(new URL("https://h.test/u")).send();
    expect(calls[0]?.url).toBe("https://h.test/u");
  });
});

describe("baseUrl", () => {
  it("joins relative paths to the base", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().baseUrl("https://h.test/api").fetch(fetch).build();
    await client.get("/users").send();
    await client.get("users").send();
    expect(calls.map((c) => c.url)).toEqual(["https://h.test/api/users", "https://h.test/api/users"]);
  });

  it("accepts a URL object", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().baseUrl(new URL("https://h.test/v1")).fetch(fetch).build();
    await client.get("a").send();
    expect(calls[0]?.url).toBe("https://h.test/v1/a");
  });

  it.each(["/api", "//h.test/api", "api", "http://"])("throws for the non-absolute or invalid base %s", (value) => {
    expect(() => HttpClient.builder().baseUrl(value)).toThrow(expect.objectContaining({ code: "http.config" }));
  });

  it("throws HttpConfigError synchronously for a base with userinfo", () => {
    const password = ["pa", "ss"].join("");
    try {
      HttpClient.builder().baseUrl(`https://user:${password}@h.test/api`);
      expect.unreachable();
    } catch (error) {
      expect(isHttpConfigError(error)).toBe(true);
      expect((error as Error).message).not.toContain(password);
    }
  });

  it("throws synchronously for a relative url without a baseUrl", () => {
    const client = HttpClient.builder().build();
    try {
      client.get("/x");
      expect.unreachable();
    } catch (error) {
      expect(isHttpConfigError(error)).toBe(true);
    }
  });

  it("is unaffected by a later change to the URL passed in", async () => {
    const { fetch, calls } = fakeFetch();
    const base = new URL("https://h.test/a");
    const builder = HttpClient.builder().baseUrl(base).fetch(fetch);
    base.pathname = "/b";
    await builder.build().get("x").send();
    expect(calls[0]?.url).toBe("https://h.test/a/x");
  });
});

describe("headers", () => {
  it("sends the client headers", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().header("x-a", "1").fetch(fetch).build();
    await client.get("https://h.test/").send();
    expect(new Headers(calls[0]?.init.headers).get("x-a")).toBe("1");
  });
});

describe("filters", () => {
  it("replaces a same-named filter in place", async () => {
    const log: string[] = [];
    const { fetch } = fakeFetch();
    const builder = HttpClient.builder().fetch(fetch);
    builder.filter(tied("a", log), tied("b", log));
    builder.filter(tied("a", log, "a2"));
    await builder.build().get("https://h.test/").send();
    expect(log).toEqual(["a2", "b"]);
  });

  it("replaces the first of two same-named filters in one call at the first's position", async () => {
    const log: string[] = [];
    const { fetch } = fakeFetch();
    const builder = HttpClient.builder().fetch(fetch);
    builder.filter(tied("a", log, "a1"), tied("b", log), tied("a", log, "a2"));
    await builder.build().get("https://h.test/").send();
    expect(log).toEqual(["a2", "b"]);
  });

  it("removes a known filter", async () => {
    const log: string[] = [];
    const { fetch } = fakeFetch();
    const builder = HttpClient.builder().fetch(fetch).filter(tied("a", log), tied("b", log));
    expect(builder.removeFilter("a")).toBe(builder);
    await builder.build().get("https://h.test/").send();
    expect(log).toEqual(["b"]);
  });

  it("throws when removing an unknown filter", () => {
    const builder = HttpClient.builder();
    expect(() => builder.removeFilter("nope")).toThrow(expect.objectContaining({ code: "http.config" }));
  });

  it("validates the order rule at build, naming both filters", () => {
    const builder = HttpClient.builder().filter(recorder("one", Order.AUTH, []), recorder("two", Order.AUTH, []));
    expect(() => builder.build()).toThrow(/"one".*"two"/);
  });
});

/** A filter at a shared order that opts in to ties, so registration order decides the run order. */
function tied(name: string, log: string[], label = name): Filter {
  return filter({
    name,
    order: 500,
    allowsOrderTie: true,
    handle: (_ctx, next) => {
      log.push(label);
      return next();
    },
  });
}

describe("snapshots and extend", () => {
  it("is unaffected by builder mutation after build", async () => {
    const { fetch, calls } = fakeFetch(500);
    const log: string[] = [];
    const builder = HttpClient.builder().baseUrl("https://h.test/a").header("x-a", "1").fetch(fetch);
    const client = builder.build();
    builder.baseUrl("https://other.test").header("x-a", "2").throwOnError().filter(tied("late", log));
    const response = await client.get("p").send();
    expect(response.status).toBe(500);
    expect(calls[0]?.url).toBe("https://h.test/a/p");
    expect(new Headers(calls[0]?.init.headers).get("x-a")).toBe("1");
    expect(log).toEqual([]);
  });

  it("extend keeps the original's settings", async () => {
    const { fetch, calls } = fakeFetch();
    const log: string[] = [];
    const client = HttpClient.builder().baseUrl("https://h.test/a").header("x-a", "1").fetch(fetch).filter(tied("f", log)).build();
    const extended = client.extend().build();
    await extended.get("p").send();
    expect(calls[0]?.url).toBe("https://h.test/a/p");
    expect(new Headers(calls[0]?.init.headers).get("x-a")).toBe("1");
    expect(log).toEqual(["f"]);
  });

  it("extend keeps throwOnError", async () => {
    const { fetch } = fakeFetch(500);
    const client = HttpClient.builder().fetch(fetch).throwOnError().build();
    await expect(client.extend().build().get("https://h.test/").send()).rejects.toSatisfy(isHttpStatusError);
  });

  it("extend does not affect the original", async () => {
    const { fetch, calls } = fakeFetch(500);
    const log: string[] = [];
    const client = HttpClient.builder()
      .baseUrl("https://h.test/a")
      .header("x-a", "1")
      .fetch(fetch)
      .filter(tied("f", log, "f"))
      .build();
    const extended = client
      .extend()
      .baseUrl("https://x.test")
      .header("x-a", "2")
      .header("x-b", "3")
      .throwOnError()
      .filter(tied("f", log, "f2"), tied("g", log))
      .build();
    await expect(extended.get("p").send()).rejects.toSatisfy(isHttpStatusError);
    expect(calls[0]?.url).toBe("https://x.test/p");
    expect(log).toEqual(["f2", "g"]);
    log.length = 0;
    const response = await client.get("p").send();
    expect(response.status).toBe(500);
    expect(calls[1]?.url).toBe("https://h.test/a/p");
    const headers = new Headers(calls[1]?.init.headers);
    expect(headers.get("x-a")).toBe("1");
    expect(headers.has("x-b")).toBe(false);
    expect(log).toEqual(["f"]);
  });

  it("the original does not affect an extended client", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().fetch(fetch).baseUrl("https://h.test/a").header("x-a", "1").build();
    const extended = client.extend().build();
    // The original is immutable; extending again from it still yields the original settings.
    await client.extend().baseUrl("https://x.test").header("x-a", "9").build().get("p").send();
    await extended.get("p").send();
    expect(calls[1]?.url).toBe("https://h.test/a/p");
    expect(new Headers(calls[1]?.init.headers).get("x-a")).toBe("1");
  });

  it("an extended client sends through the injected fetch, once per request", async () => {
    const { fetch, calls } = fakeFetch();
    const client = HttpClient.builder().fetch(fetch).build();
    await client.extend().build().get("https://h.test/").send();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://h.test/");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("extend without an injected fetch still reads globalThis.fetch at dispatch", async () => {
    const client = HttpClient.builder().build().extend().build();
    const stub = vi.fn(async () => new Response("s"));
    vi.stubGlobal("fetch", stub);
    await client.get("https://h.test/").send();
    expect(stub).toHaveBeenCalledOnce();
  });
});

describe("resilience", () => {
  /** "api" holds a three-attempt retry with no backoff and a one-call bulkhead. */
  function registry(): ResilienceRegistry {
    return createRegistry((b) =>
      b.configure("retry", "api", { maxAttempts: 3, backoff: fixedBackoff(0) }).configure("bulkhead", "api", { maxConcurrent: 1 }),
    );
  }

  /** A fetch that never settles, so a call holds its bulkhead permit. */
  const hangingFetch: HttpFetch = () => new Promise<never>(() => {});

  async function refusesSecondCall(client: HttpClient): Promise<boolean> {
    void client.get("https://h.test/").send();
    const error = await client
      .get("https://h.test/")
      .send()
      .catch((caught: unknown) => caught);
    return isBulkheadFullError(error);
  }

  it("adds the registry's filters for the name", async () => {
    const { fetch, calls } = fakeFetch(503);
    const client = HttpClient.builder()
      .fetch(fetch)
      .resilience(registry(), "api", { kinds: ["retry"] })
      .build();
    expect((await client.get("https://h.test/").send()).status).toBe(503);
    expect(calls).toHaveLength(3);
  });

  it("a second call replaces the whole set, even with other kinds", async () => {
    const shared = registry();
    const { fetch, calls } = fakeFetch(503);
    const client = HttpClient.builder()
      .fetch(fetch)
      .resilience(shared, "api", { kinds: ["retry"] })
      .resilience(shared, "api", { kinds: ["bulkhead"] })
      .build();
    expect((await client.get("https://h.test/").send()).status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(await refusesSecondCall(client.extend().fetch(hangingFetch).build())).toBe(true);
  });

  it("removes a filter of the same name added by hand, and keeps every other filter", async () => {
    const { fetch } = fakeFetch();
    const log: string[] = [];
    const client = HttpClient.builder()
      .fetch(fetch)
      .filter(recorder("retry", Order.RETRY, log), recorder("other", Order.AUTH, log))
      .resilience(registry(), "api", { kinds: ["bulkhead"] })
      .build();
    await client.get("https://h.test/").send();
    expect(log).toEqual(["other"]);
  });

  it("replaces the whole set through extend, leaving the original's", async () => {
    const shared = registry();
    const { fetch, calls } = fakeFetch(503);
    const original = HttpClient.builder()
      .fetch(fetch)
      .resilience(shared, "api", { kinds: ["retry"] })
      .build();
    const extended = original
      .extend()
      .resilience(shared, "api", { kinds: ["bulkhead"] })
      .build();
    await extended.get("https://h.test/").send();
    expect(calls).toHaveLength(1);
    await original.get("https://h.test/").send();
    expect(calls).toHaveLength(4);
    expect(await refusesSecondCall(extended.extend().fetch(hangingFetch).build())).toBe(true);
  });

  it("leaves the builder unchanged when the set cannot be built", async () => {
    const shared = registry();
    const { fetch, calls } = fakeFetch(503);
    const builder = HttpClient.builder()
      .fetch(fetch)
      .resilience(shared, "api", { kinds: ["retry"] });
    expect(() => builder.resilience(shared, "missing")).toThrow(expect.toSatisfy(isHttpConfigError));
    await builder.build().get("https://h.test/").send();
    expect(calls).toHaveLength(3);
  });
});

describe("throwOnError", () => {
  it("is off by default", async () => {
    const { fetch } = fakeFetch(404);
    const response = await HttpClient.builder().fetch(fetch).build().get("https://h.test/").send();
    expect(response.status).toBe(404);
  });

  it("throwOnError() reaches send", async () => {
    const { fetch } = fakeFetch(404);
    const client = HttpClient.builder().fetch(fetch).throwOnError().build();
    await expect(client.get("https://h.test/").send()).rejects.toSatisfy(isHttpStatusError);
  });

  it("throwOnError(false) reaches send", async () => {
    const { fetch } = fakeFetch(404);
    const client = HttpClient.builder().fetch(fetch).throwOnError().throwOnError(false).build();
    expect((await client.get("https://h.test/").send()).status).toBe(404);
  });
});

describe("default fetch", () => {
  it("reads globalThis.fetch at dispatch when none is injected", async () => {
    const client = HttpClient.builder().build();
    const stub = vi.fn(async () => new Response("stubbed"));
    vi.stubGlobal("fetch", stub);
    const text = await client.get("https://h.test/s").text();
    expect(text).toBe("stubbed");
    expect(stub).toHaveBeenCalledOnce();
    expect(stub.mock.calls[0]).toEqual(["https://h.test/s", expect.objectContaining({ method: "GET" })]);
  });
});

describe("end to end", () => {
  it("reads JSON through a two-filter chain", async () => {
    const attempts: number[] = [];
    const seen: Array<string | null> = [];
    const auth = filter({
      name: "auth",
      order: Order.AUTH,
      handle: (ctx, next) => {
        ctx.request.headers.set("authorization", "t");
        return next();
      },
    });
    const observe = filter({
      name: "observe",
      order: Order.OBSERVABILITY,
      handle: (ctx, next) => {
        attempts.push(ctx.attempt);
        return next();
      },
    });
    const fetch: HttpFetch = async (_url, init) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return Response.json({ id: 7 });
    };
    const client = HttpClient.builder().baseUrl("https://h.test").fetch(fetch).filter(auth, observe).build();
    const body = await client.get("/things/7").json<{ id: number }>();
    expect(body).toEqual({ id: 7 });
    expect(attempts).toEqual([1]);
    expect(seen).toEqual(["t"]);
  });
});
