import { describe, expect, test, vi } from "vitest";
import { applyReplacement } from "./replacement";

describe("string replacement", () => {
  test("is returned unchanged regardless of the value and key passed", () => {
    expect(applyReplacement("[REDACTED]", "hunter2", "password")).toBe("[REDACTED]");
    expect(applyReplacement("[REDACTED]", 42, "pin")).toBe("[REDACTED]");
    expect(applyReplacement("[REDACTED]", undefined, "token")).toBe("[REDACTED]");
  });
});

describe("function replacement", () => {
  test("is invoked with the exact value and key passed, and its return value is returned", () => {
    const replacement = vi.fn((value: unknown, key: string) => `${key}:${String(value)}`);

    const result = applyReplacement(replacement, "hunter2", "password");

    expect(replacement).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledWith("hunter2", "password");
    expect(result).toBe("password:hunter2");
  });
});
