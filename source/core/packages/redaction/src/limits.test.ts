import { describe, expect, test } from "vitest";
import {
  BREADTH_TRUNCATION_KEY,
  breadthMarker,
  breadthMarkerKey,
  DEFAULT_MAX_BREADTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_STRING_LENGTH,
  exceedsBreadth,
  isBreadthFull,
  keepWithinBreadth,
  resolveLimits,
  STRING_TRUNCATION_SUFFIX,
  TRUNCATED,
  truncateString,
  uniqueBreadthMarker,
} from "./limits";

describe("defaults and markers", () => {
  test("the defaults and markers are the literal values toJsonSafe uses", () => {
    expect(DEFAULT_MAX_DEPTH).toBe(6);
    expect(DEFAULT_MAX_BREADTH).toBe(100);
    expect(DEFAULT_MAX_STRING_LENGTH).toBe(8192);
    expect(TRUNCATED).toBe("[Truncated]");
    // biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
    expect(STRING_TRUNCATION_SUFFIX).toBe("…[truncated]");
    expect(BREADTH_TRUNCATION_KEY).toBe("…");
    expect(breadthMarker(103, resolveLimits())).toBe("[Truncated: 3 more]");
  });
});

describe("resolveLimits", () => {
  test("fills in every limit left out with its default", () => {
    expect(resolveLimits()).toEqual({ maxDepth: 6, maxBreadth: 100, maxStringLength: 8192 });
    expect(resolveLimits({})).toEqual({ maxDepth: 6, maxBreadth: 100, maxStringLength: 8192 });
  });

  test("keeps every limit given, Infinity and NaN included, without validating it", () => {
    expect(resolveLimits({ maxDepth: 2, maxBreadth: Number.POSITIVE_INFINITY, maxStringLength: Number.NaN })).toEqual({
      maxDepth: 2,
      maxBreadth: Number.POSITIVE_INFINITY,
      maxStringLength: Number.NaN,
    });
  });
});

describe("truncateString", () => {
  test("a string within the limit is returned unchanged", () => {
    expect(truncateString("abcd", resolveLimits({ maxStringLength: 4 }))).toBe("abcd");
  });

  test("a string over the limit is cut to the limit and suffixed, the suffix not counted", () => {
    expect(truncateString("abcdef", resolveLimits({ maxStringLength: 4 }))).toBe(`abcd${STRING_TRUNCATION_SUFFIX}`);
  });

  test("the cut is by UTF-16 code unit, so it can split a surrogate pair", () => {
    expect(truncateString("a😀", resolveLimits({ maxStringLength: 2 }))).toBe(`a\uD83D${STRING_TRUNCATION_SUFFIX}`);
  });

  test("a NaN limit leaves every string whole", () => {
    expect(truncateString("x".repeat(10_000), resolveLimits({ maxStringLength: Number.NaN }))).toHaveLength(10_000);
  });
});

describe("breadth", () => {
  test("items within the limit are returned as they are", () => {
    const items = [1, 2];
    expect(keepWithinBreadth(items, resolveLimits({ maxBreadth: 2 }))).toBe(items);
    expect(exceedsBreadth(2, resolveLimits({ maxBreadth: 2 }))).toBe(false);
  });

  test("items over the limit are cut to the first maxBreadth", () => {
    expect(keepWithinBreadth([1, 2, 3], resolveLimits({ maxBreadth: 2 }))).toEqual([1, 2]);
    expect(exceedsBreadth(3, resolveLimits({ maxBreadth: 2 }))).toBe(true);
  });

  test("a NaN limit keeps every item rather than none", () => {
    const limits = resolveLimits({ maxBreadth: Number.NaN });
    expect(keepWithinBreadth([1, 2, 3], limits)).toEqual([1, 2, 3]);
    expect(exceedsBreadth(3, limits)).toBe(false);
  });

  test("a count is full once it reaches the limit, and never under NaN", () => {
    const limits = resolveLimits({ maxBreadth: 2 });
    expect(isBreadthFull(1, limits)).toBe(false);
    expect(isBreadthFull(2, limits)).toBe(true);
    expect(isBreadthFull(2, resolveLimits({ maxBreadth: Number.NaN }))).toBe(false);
    expect(isBreadthFull(2, resolveLimits({ maxBreadth: 2.5 }))).toBe(true);
  });

  test("the marker key is raised past every key already in use", () => {
    expect(breadthMarkerKey(new Set(["a"]))).toBe("…");
    expect(breadthMarkerKey(new Set(["…"]))).toBe("…#1");
    expect(breadthMarkerKey(new Set(["…", "…#1"]))).toBe("…#2");
  });

  test("the marker text is raised past every member already in use", () => {
    const marker = "[Truncated: 1 more]";

    expect(uniqueBreadthMarker(marker, (candidate) => new Set(["a"]).has(candidate))).toBe(marker);
    expect(uniqueBreadthMarker(marker, (candidate) => new Set([marker]).has(candidate))).toBe(`${marker}#1`);
    expect(uniqueBreadthMarker(marker, (candidate) => new Set([marker, `${marker}#1`]).has(candidate))).toBe(`${marker}#2`);
  });
});
