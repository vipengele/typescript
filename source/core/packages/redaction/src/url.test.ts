// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { describe, expect, test, vi } from "vitest";
import type { RedactionPolicy } from "./key-matcher";
import { STRING_TRUNCATION_SUFFIX } from "./limits";
import { redactUrl } from "./url";

describe("userinfo", () => {
  test("replaces both the username and the password", () => {
    expect(redactUrl("https://ada:hunter2@example.com/path")).toBe("https://[REDACTED]:[REDACTED]@example.com/path");
  });

  test("replaces a username given without a password", () => {
    expect(redactUrl("https://ada@example.com")).toBe("https://[REDACTED]@example.com");
  });

  test("replaces an empty password, and an empty username before a password", () => {
    expect(redactUrl("https://ada:@example.com")).toBe("https://[REDACTED]:[REDACTED]@example.com");
    expect(redactUrl("https://:hunter2@example.com")).toBe("https://[REDACTED]:[REDACTED]@example.com");
  });

  test("keeps an authority whose userinfo is empty", () => {
    expect(redactUrl("https://@example.com/")).toBe("https://@example.com/");
  });

  test("replaces userinfo whatever the policy", () => {
    expect(redactUrl("https://ada:pw@example.com", { policy: { keys: [] } })).toBe("https://[REDACTED]:[REDACTED]@example.com");
  });

  test("the userinfo ends at the last @ in the authority, so an @ inside it is replaced", () => {
    expect(redactUrl("https://ada:p@ss@w0rd@example.com/x")).toBe("https://[REDACTED]:[REDACTED]@example.com/x");
    expect(redactUrl("https://a@b:c@example.com")).toBe("https://[REDACTED]:[REDACTED]@example.com");
  });

  test("the password runs from the first : in the userinfo, so a : inside it is replaced", () => {
    expect(redactUrl("https://ada:a:b@example.com")).toBe("https://[REDACTED]:[REDACTED]@example.com");
  });

  test("an @ in the path, query or fragment is not userinfo", () => {
    expect(redactUrl("https://example.com/users/@ada")).toBe("https://example.com/users/@ada");
    expect(redactUrl("https://example.com?email=a@b.c")).toBe("https://example.com?email=a@b.c");
    expect(redactUrl("https://example.com#a@b")).toBe("https://example.com#a@b");
    expect(redactUrl("https://example.com/?x=1#token=a@b")).toBe("https://example.com/?x=1#token=[REDACTED]");
  });

  test("only the userinfo before the first / is replaced when the path holds another @", () => {
    expect(redactUrl("https://ada:pw@example.com/a@b")).toBe("https://[REDACTED]:[REDACTED]@example.com/a@b");
  });

  test("keeps the port and the host as written", () => {
    expect(redactUrl("HTTP://ada:pw@Example.COM:8080/")).toBe("HTTP://[REDACTED]:[REDACTED]@Example.COM:8080/");
  });

  test("replaces userinfo in a protocol-relative URL", () => {
    expect(redactUrl("//ada:pw@example.com/x?y=1")).toBe("//[REDACTED]:[REDACTED]@example.com/x?y=1");
  });

  test("replaces userinfo in any scheme with an authority", () => {
    expect(redactUrl("postgres+ssl.v2://app:pw@db:5432/main")).toBe("postgres+ssl.v2://[REDACTED]:[REDACTED]@db:5432/main");
  });

  test("replaces userinfo behind leading spaces and control characters, and keeps them", () => {
    expect(redactUrl(" \t\nhttps://ada:pw@example.com")).toBe(" \t\nhttps://[REDACTED]:[REDACTED]@example.com");
  });

  test("a \\ does not end the authority, so userinfo before it is not let through", () => {
    expect(redactUrl("https://ada\\x:pw@example.com")).toBe("https://[REDACTED]:[REDACTED]@example.com");
  });

  test("a string with no authority has no userinfo", () => {
    expect(redactUrl("ada:pw@example.com")).toBe("ada:pw@example.com");
    expect(redactUrl("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(redactUrl("/path/ada:pw@x")).toBe("/path/ada:pw@x");
    expect(redactUrl("1http://ada:pw@x")).toBe("1http://ada:pw@x");
  });

  test("uses the configured replacement, with the part as written and its key", () => {
    const replacement = vi.fn((value: unknown, key: string) => `<${key}:${String(value)}>`);
    expect(redactUrl("https://a%40b:p%20w@example.com", { replacement })).toBe("https://<username:a%40b>:<password:p%20w>@example.com");
    expect(replacement).toHaveBeenCalledWith("a%40b", "username");
    expect(replacement).toHaveBeenCalledWith("p%20w", "password");
  });

  test("a non-string replacement is converted with String()", () => {
    expect(redactUrl("https://a:b@h", { replacement: () => 0 })).toBe("https://0:0@h");
    expect(redactUrl("https://a@h", { replacement: "***" })).toBe("https://***@h");
  });
});

describe("query", () => {
  test("redacts the query by the policy and keeps the rest of the URL", () => {
    expect(redactUrl("https://example.com/cb?code=1&access_token=abc&page=2")).toBe(
      "https://example.com/cb?code=1&access_token=[REDACTED]&page=2",
    );
  });

  test("the query ends at the first #", () => {
    expect(redactUrl("/cb?token=a#section")).toBe("/cb?token=[REDACTED]#section");
  });

  test("a ? after the # belongs to the fragment", () => {
    const policy: RedactionPolicy = { keys: ["token"] };
    expect(redactUrl("/cb#x?token=a", { policy })).toBe("/cb#x?token=a");
  });

  test("only the first ? starts the query; a later one is part of it", () => {
    expect(redactUrl("/cb?a=1?token=b&token=c")).toBe("/cb?a=1?token=b&token=[REDACTED]");
  });

  test("keeps an empty query and an empty fragment", () => {
    expect(redactUrl("https://example.com/?")).toBe("https://example.com/?");
    expect(redactUrl("https://example.com/#")).toBe("https://example.com/#");
    expect(redactUrl("https://example.com/?#")).toBe("https://example.com/?#");
  });

  test("a URL with no query and no fragment is returned unchanged", () => {
    expect(redactUrl("https://example.com/path/to")).toBe("https://example.com/path/to");
  });

  test("a custom policy replaces secretKeys", () => {
    const policy: RedactionPolicy = { keys: ["sig"] };
    expect(redactUrl("https://s3.example.com/o?sig=abc&token=t", { policy })).toBe("https://s3.example.com/o?sig=[REDACTED]&token=t");
  });

  test("a function replacement receives the decoded value and the decoded name", () => {
    const replacement = vi.fn((value: unknown, key: string) => `${key}|${String(value)}`.length);
    expect(redactUrl("/x?access%5Ftoken=a%20b", { replacement })).toBe("/x?access%5Ftoken=16");
    expect(replacement).toHaveBeenCalledWith("a b", "access_token");
  });
});

describe("fragment", () => {
  test("a fragment holding a name=value pair is redacted as a parameter list", () => {
    expect(redactUrl("https://app.example.com/cb#access_token=abc&expires_in=3600&state=s")).toBe(
      "https://app.example.com/cb#access_token=[REDACTED]&expires_in=3600&state=s",
    );
  });

  test("a fragment with no name=value pair is kept whole", () => {
    expect(redactUrl("/doc#section-2")).toBe("/doc#section-2");
    expect(redactUrl("/doc#token")).toBe("/doc#token");
  });

  test("a pair with an empty name does not make the fragment a parameter list", () => {
    expect(redactUrl("/doc#=", { policy: { keys: [""] } })).toBe("/doc#=");
    expect(redactUrl("/doc#=x&y", { policy: { keys: [""] } })).toBe("/doc#=x&y");
  });

  test("one name=value pair anywhere makes the whole fragment a parameter list", () => {
    expect(redactUrl("/doc#intro&token=a&=b", { policy: { keys: ["token", ""] } })).toBe("/doc#intro&token=[REDACTED]&=[REDACTED]");
  });

  test("a pair with an empty value counts", () => {
    expect(redactUrl("/doc#token=")).toBe("/doc#token=[REDACTED]");
  });

  test("a later # is part of the fragment", () => {
    expect(redactUrl("/cb#a=1#token=x&token=y")).toBe("/cb#a=1#token=x&token=[REDACTED]");
  });

  test("query and fragment are both redacted", () => {
    expect(redactUrl("//h/cb?token=q&id=1#id_token=f")).toBe("//h/cb?token=[REDACTED]&id=1#id_token=[REDACTED]");
  });
});

describe("input forms", () => {
  test("relative paths, bare queries and bare fragments are accepted", () => {
    expect(redactUrl("cb?token=a")).toBe("cb?token=[REDACTED]");
    expect(redactUrl("?token=a")).toBe("?token=[REDACTED]");
    expect(redactUrl("#token=a")).toBe("#token=[REDACTED]");
    expect(redactUrl("")).toBe("");
  });

  test("malformed input is redacted textually and never throws", () => {
    expect(redactUrl("ht!tp:://u:p@/?%zz=1&token=%E0%A4%A")).toBe("ht!tp:://u:p@/?%zz=[REDACTED]&token=[REDACTED]");
    expect(redactUrl("https://")).toBe("https://");
    expect(redactUrl("https://@")).toBe("https://@");
    expect(redactUrl("https://u@")).toBe("https://[REDACTED]@");
    expect(redactUrl("\uD800?token=\uDC00")).toBe("\uD800?token=[REDACTED]");
  });

  test("every byte outside a replaced value is kept as written", () => {
    const url = "https://example.com/a%20b/c+d~e!f?q=a%20b+c~d!e&x=%7E&&y#frag%20+~!";
    expect(redactUrl(url)).toBe(url);
    expect(redactUrl("/p?q=%20+~!&token=%20+~!&r=~")).toBe("/p?q=%20+~!&token=[REDACTED]&r=~");
  });

  test("does not mutate its input", () => {
    const url = "https://a:b@h/?token=x";
    redactUrl(url);
    expect(url).toBe("https://a:b@h/?token=x");
  });
});

describe("limits", () => {
  test("cuts the redacted result to maxStringLength last", () => {
    const url = "https://a:b@h/?token=xxxxxxxxxxxxxxxxxxxxxxxx&id=1";
    expect(redactUrl(url, { maxStringLength: 30 })).toBe(`https://[REDACTED]:[REDACTED]@${STRING_TRUNCATION_SUFFIX}`);
    expect(redactUrl(url, { maxStringLength: 60 })).toBe("https://[REDACTED]:[REDACTED]@h/?token=[REDACTED]&id=1");
  });

  test("defaults maxStringLength to 8192", () => {
    const url = `/x?q=${"a".repeat(9000)}`;
    expect(redactUrl(url)).toBe(`${url.slice(0, 8192)}${STRING_TRUNCATION_SUFFIX}`);
  });

  test("maxBreadth bounds the query and the fragment separately", () => {
    expect(redactUrl("/x?a=1&b=2&token=3#c=1&d=2&token=3", { maxBreadth: 2 })).toBe(
      "/x?a=1&b=2&[Truncated: 1 more]#c=1&d=2&[Truncated: 1 more]",
    );
  });

  test("maxBreadth does not apply to a fragment that is not a parameter list", () => {
    expect(redactUrl("/x#a&b&c", { maxBreadth: 1 })).toBe("/x#a&b&c");
  });
});
