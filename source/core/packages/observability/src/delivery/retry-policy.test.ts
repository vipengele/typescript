import { describe, expect, test } from "vitest";
import { classifyStatus, parseRetryAfter } from "./retry-policy";

describe("classifyStatus", () => {
  test("treats every 2xx as delivered", () => {
    expect(classifyStatus(200)).toBe("delivered");
    expect(classifyStatus(202)).toBe("delivered");
    expect(classifyStatus(299)).toBe("delivered");
  });

  test("retries throttling and transient gateway and server failures", () => {
    for (const status of [429, 502, 503, 504]) {
      expect(classifyStatus(status)).toBe("retryable");
    }
  });

  test("rejects every other status", () => {
    for (const status of [0, 199, 300, 400, 401, 404, 413, 500, 501, 505]) {
      expect(classifyStatus(status)).toBe("rejected");
    }
  });
});

describe("parseRetryAfter", () => {
  test("gives undefined for an absent header", () => {
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });

  test("reads delta-seconds as milliseconds", () => {
    expect(parseRetryAfter("0", 0)).toBe(0);
    expect(parseRetryAfter("7", 0)).toBe(7000);
    expect(parseRetryAfter(" 120 ", 0)).toBe(120_000);
  });

  test("reads an HTTP-date relative to now", () => {
    const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Wednesday, 21-Oct-26 07:28:30 GMT", now)).toBe(30_000);
  });

  test("gives 0 for an HTTP-date already passed", () => {
    const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:27:00 GMT", now)).toBe(0);
  });

  test("gives undefined for a value that is neither form", () => {
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter("-5", 0)).toBeUndefined();
    expect(parseRetryAfter("", 0)).toBeUndefined();
    expect(parseRetryAfter("2026-10-21", 0)).toBeUndefined();
    expect(parseRetryAfter("Wed, 99 Foo 2026", 0)).toBeUndefined();
  });
});
