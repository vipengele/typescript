import { describe, expect, it, vi } from "vitest";
import { toHttpResponse } from "./http-response";

describe("toHttpResponse", () => {
  it("mirrors the fields of the raw response", () => {
    const raw = new Response("body", { status: 201, statusText: "Created", headers: { "x-one": "1" } });
    const response = toHttpResponse(raw, "POST");

    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
    expect(response.statusText).toBe("Created");
    expect(response.headers).toBe(raw.headers);
    expect(response.url).toBe(raw.url);
    expect(response.raw).toBe(raw);
  });

  it("reports ok false for an error status", () => {
    expect(toHttpResponse(new Response("no", { status: 500 }), "GET").ok).toBe(false);
  });

  describe("json", () => {
    it("parses a JSON body", async () => {
      const response = toHttpResponse(new Response('{"a":1}'), "GET");

      await expect(response.json<{ a: number }>()).resolves.toEqual({ a: 1 });
    });

    it("resolves undefined for status 204", async () => {
      await expect(toHttpResponse(new Response(null, { status: 204 }), "GET").json()).resolves.toBeUndefined();
    });

    it("resolves undefined for status 205", async () => {
      await expect(toHttpResponse(new Response(null, { status: 205 }), "GET").json()).resolves.toBeUndefined();
    });

    it("resolves undefined for a HEAD request", async () => {
      await expect(toHttpResponse(new Response("{}", { status: 200 }), "HEAD").json()).resolves.toBeUndefined();
    });

    it("resolves undefined for an empty body", async () => {
      await expect(toHttpResponse(new Response("", { status: 200 }), "GET").json()).resolves.toBeUndefined();
    });

    it("rejects with a SyntaxError for invalid JSON", async () => {
      await expect(toHttpResponse(new Response("{nope"), "GET").json()).rejects.toBeInstanceOf(SyntaxError);
    });
  });

  it("reads the body as text", async () => {
    await expect(toHttpResponse(new Response("hello"), "GET").text()).resolves.toBe("hello");
  });

  describe("discard", () => {
    it("cancels the body", async () => {
      const raw = new Response("unread");
      const cancel = vi.spyOn(raw.body as ReadableStream, "cancel");

      await expect(toHttpResponse(raw, "GET").discard()).resolves.toBeUndefined();

      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("resolves undefined when there is no body", async () => {
      await expect(toHttpResponse(new Response(null), "GET").discard()).resolves.toBeUndefined();
    });
  });
});
