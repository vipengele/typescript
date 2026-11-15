import { describe, expect, it } from "vitest";
import { isHttpConfigError } from "./errors/http-errors";
import { resolveUrl } from "./url";

const base = new URL("https://api.example.com/v1");
const slashBase = new URL("https://api.example.com/v1/");

describe("resolveUrl absolute input", () => {
  it.each([
    ["https URL", "https://example.org/a?b=1#c", "https://example.org/a?b=1#c"],
    ["custom scheme", "foo+bar://host/path", "foo+bar://host/path"],
    ["uppercase scheme", "HTTPS://example.org/a", "https://example.org/a"],
  ])("uses a %s as it is, ignoring the base", (_name, input, expected) => {
    expect(resolveUrl(input, base).href).toBe(expected);
    expect(resolveUrl(input).href).toBe(expected);
  });

  it("returns a fresh copy of a URL object", () => {
    const input = new URL("https://example.org/a");
    const resolved = resolveUrl(input, base);
    expect(resolved).not.toBe(input);
    expect(resolved.href).toBe(input.href);
    resolved.pathname = "/changed";
    expect(input.pathname).toBe("/a");
  });

  it("throws a config error with a cause for an absolute string that does not parse", () => {
    try {
      resolveUrl("https://");
      expect.unreachable();
    } catch (error) {
      expect(isHttpConfigError(error)).toBe(true);
      expect((error as Error).cause).toBeInstanceOf(TypeError);
    }
  });
});

describe("resolveUrl relative input", () => {
  it.each([
    [base, "/orders/42"],
    [base, "orders/42"],
    [slashBase, "/orders/42"],
    [slashBase, "orders/42"],
  ])("joins %s and %s with exactly one slash", (baseUrl, path) => {
    expect(resolveUrl(path, baseUrl).href).toBe("https://api.example.com/v1/orders/42");
  });

  it("joins to a base with an empty path", () => {
    expect(resolveUrl("orders", new URL("https://api.example.com")).href).toBe("https://api.example.com/orders");
  });

  it("keeps the path's query and hash", () => {
    expect(resolveUrl("/orders?id=1#top", base).href).toBe(new URL("v1/orders?id=1#top", base.origin).href);
  });

  it("drops the base's query and hash", () => {
    const withQuery = new URL("https://h.test/v1?k=1#f");
    expect(resolveUrl("orders", withQuery).href).toBe("https://h.test/v1/orders");
  });

  it("keeps the base's userinfo and port", () => {
    const withAuth = new URL("http://user:pw@localhost:8080/v1");
    expect(resolveUrl("/x", withAuth).href).toBe("http://user:pw@localhost:8080/v1/x");
  });

  it("lets .. climb above the base path", () => {
    expect(resolveUrl("../x", base).href).toBe("https://api.example.com/x");
    expect(resolveUrl("../../x", base).href).toBe("https://api.example.com/x");
  });

  it("treats a string without :// as relative", () => {
    expect(resolveUrl("localhost:3000/x", base).href).toBe("https://api.example.com/v1/localhost:3000/x");
  });

  it("does not change the base", () => {
    const original = new URL("https://h.test/v1?k=1#f");
    resolveUrl("orders", original);
    expect(original.href).toBe("https://h.test/v1?k=1#f");
  });
});

describe("resolveUrl errors", () => {
  it("throws a config error for a protocol-relative URL", () => {
    expect(() => resolveUrl("//host/x", base)).toThrow(expect.objectContaining({ code: "http.config" }));
    try {
      resolveUrl("//host/x", base);
    } catch (error) {
      expect(isHttpConfigError(error)).toBe(true);
    }
  });

  it("throws a config error for a relative path without a base", () => {
    try {
      resolveUrl("/orders");
      expect.unreachable();
    } catch (error) {
      expect(isHttpConfigError(error)).toBe(true);
    }
  });
});
