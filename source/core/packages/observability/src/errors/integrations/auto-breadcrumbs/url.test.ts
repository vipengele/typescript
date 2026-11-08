// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test } from "vitest";
import { redactBreadcrumbUrl, UNREDACTABLE_URL } from "./url";

describe("redactBreadcrumbUrl", () => {
  test("redacts a secret query parameter with secretKeys by default", () => {
    expect(redactBreadcrumbUrl("https://api.example.com/items?token=abc&page=2")).toBe(
      "https://api.example.com/items?token=[REDACTED]&page=2",
    );
  });

  test("always replaces userinfo", () => {
    expect(redactBreadcrumbUrl("https://user:pass@example.com/")).not.toContain("pass");
  });

  test("applies the given policy", () => {
    const policy: RedactionPolicy = { keys: ["page"] };

    expect(redactBreadcrumbUrl("/items?token=abc&page=2", policy)).toBe("/items?token=abc&page=[REDACTED]");
  });

  test("falls back to secretKeys for a policy that is not an object", () => {
    const notAPolicy = null as unknown as RedactionPolicy;

    expect(redactBreadcrumbUrl("/items?token=abc", notAPolicy)).toBe(redactBreadcrumbUrl("/items?token=abc", secretKeys));
  });

  test("gives the placeholder, never the raw URL, when the policy throws", () => {
    const throwing = new Proxy({} as RedactionPolicy, {
      get() {
        throw new Error("boom");
      },
    });

    expect(redactBreadcrumbUrl("/items?token=abc", throwing)).toBe(UNREDACTABLE_URL);
  });
});
