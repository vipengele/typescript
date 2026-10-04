import { describe, expect, test, vi } from "vitest";
import { findDetectorSpans, replaceSpans, type Span } from "./detector";
import type { Detector } from "./key-matcher";

describe("findDetectorSpans", () => {
  test("no detectors, an empty detectors list or an empty string yields no spans", () => {
    expect(findDetectorSpans(undefined, "secret")).toEqual([]);
    expect(findDetectorSpans([], "secret")).toEqual([]);
    expect(findDetectorSpans([{ pattern: /.+/ }], "")).toEqual([]);
  });

  test("every match of a detector is a span, whatever the pattern's own flags", () => {
    expect(findDetectorSpans([{ pattern: /\d+/ }], "a12b345c")).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  test("disjoint matches from different detectors stay separate and sorted by start", () => {
    const detectors: Detector[] = [{ pattern: /cd/ }, { pattern: /ab/ }];
    expect(findDetectorSpans(detectors, "ab-cd")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  test("overlapping matches from different detectors merge into one span", () => {
    const detectors: Detector[] = [{ pattern: /abc/ }, { pattern: /bcde/ }, { pattern: /c/ }];
    expect(findDetectorSpans(detectors, "xabcdex")).toEqual([{ start: 1, end: 6 }]);
  });

  test("a match contained in another merges into the outer span", () => {
    const detectors: Detector[] = [{ pattern: /abcdef/ }, { pattern: /cd/ }];
    expect(findDetectorSpans(detectors, "abcdef")).toEqual([{ start: 0, end: 6 }]);
  });

  test("touching matches, one ending where the next starts, merge into one span", () => {
    const detectors: Detector[] = [{ pattern: /ab/ }, { pattern: /cd/ }];
    expect(findDetectorSpans(detectors, "abcd")).toEqual([{ start: 0, end: 4 }]);
  });

  test("a match validate rejects yields no span", () => {
    const detectors: Detector[] = [{ pattern: /\d+/, validate: (match) => match !== "12" }];
    expect(findDetectorSpans(detectors, "12 34")).toEqual([{ start: 3, end: 5 }]);
  });

  test("validate sees each detector's raw match, before merging", () => {
    const validate = vi.fn((_match: string) => true);
    const detectors: Detector[] = [{ pattern: /abc/, validate }, { pattern: /cde/ }];
    expect(findDetectorSpans(detectors, "abcde")).toEqual([{ start: 0, end: 5 }]);
    expect(validate.mock.calls).toEqual([["abc"]]);
  });

  test("a rejected match does not bridge two accepted ones", () => {
    const detectors: Detector[] = [{ pattern: /ab/ }, { pattern: /b-c/, validate: () => false }, { pattern: /cd/ }];
    expect(findDetectorSpans(detectors, "ab-cd")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});

describe("the caller's regex", () => {
  test("a global regex keeps its flags and its non-zero lastIndex", () => {
    const pattern = /\d+/g;
    pattern.lastIndex = 5;
    expect(findDetectorSpans([{ pattern }], "12 34 56")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
    expect(pattern.lastIndex).toBe(5);
    expect(pattern.flags).toBe("g");
  });

  test("a sticky regex matches anywhere, not only at the cursor, and is left untouched", () => {
    const pattern = /\d+/gy;
    pattern.lastIndex = 3;
    expect(findDetectorSpans([{ pattern }], "ab12cd34")).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ]);
    expect(pattern.lastIndex).toBe(3);
    expect(pattern.flags).toBe("gy");
  });

  test("a sticky regex without g still finds every match", () => {
    const pattern = /x/y;
    expect(findDetectorSpans([{ pattern }], "axbx")).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
    expect(pattern.lastIndex).toBe(0);
    expect(pattern.flags).toBe("y");
  });

  test("the regex's other flags apply to the scan", () => {
    expect(findDetectorSpans([{ pattern: /^key$/im }], "KEY\nother\nkey")).toEqual([
      { start: 0, end: 3 },
      { start: 10, end: 13 },
    ]);
  });
});

describe("zero-length matches", () => {
  test("a pattern that only matches the empty string yields no spans and terminates", () => {
    expect(findDetectorSpans([{ pattern: /(?:)/ }], "abc")).toEqual([]);
    expect(findDetectorSpans([{ pattern: /(?:)/u }], "a\u{1F600}b")).toEqual([]);
  });

  test("a non-empty match after a zero-length one is still found, including at the end", () => {
    expect(findDetectorSpans([{ pattern: /a*/ }], "bab")).toEqual([{ start: 1, end: 2 }]);
    expect(findDetectorSpans([{ pattern: /a*/u }], "ba")).toEqual([{ start: 1, end: 2 }]);
  });

  // An empty match just before the emoji, or a lone low surrogate: stepping one code unit past the
  // empty match lands on the emoji's low surrogate, which the second alternative then matches.
  // biome-ignore lint/security/noSecrets: a regex source of escape sequences, flagged only for its entropy
  const SURROGATE_PROBE = "(?=\\uD83D\\uDE00)|[\\uDC00-\\uDFFF]";
  const EMOJI = "\u{1F600}";
  const LONE_LOW = "\uDC00";

  test("without u, the scan steps one code unit and can stop inside a surrogate pair", () => {
    const pattern = new RegExp(SURROGATE_PROBE, "");
    expect(findDetectorSpans([{ pattern }], EMOJI)).toEqual([{ start: 1, end: 2 }]);
  });

  test.each(["u", "v"])("under %s, the scan steps over a whole surrogate pair", (flag) => {
    const pattern = new RegExp(SURROGATE_PROBE, flag);
    expect(findDetectorSpans([{ pattern }], EMOJI)).toEqual([]);
    expect(findDetectorSpans([{ pattern }], `a${EMOJI}${LONE_LOW}`)).toEqual([{ start: 3, end: 4 }]);
  });
});

describe("normalization", () => {
  test("a detectors list is read once, so changing it afterwards has no effect", () => {
    const detectors: Detector[] = [{ pattern: /ab/ }];
    expect(findDetectorSpans(detectors, "abcd")).toEqual([{ start: 0, end: 2 }]);
    detectors.push({ pattern: /cd/ });
    expect(findDetectorSpans(detectors, "abcd")).toEqual([{ start: 0, end: 2 }]);
    expect(findDetectorSpans(detectors, "ab ab")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(findDetectorSpans([...detectors], "abcd")).toEqual([{ start: 0, end: 4 }]);
  });

  test("repeated scans with one detector each start from the beginning of the string", () => {
    const detectors: Detector[] = [{ pattern: /\d/g }];
    expect(findDetectorSpans(detectors, "1a")).toEqual([{ start: 0, end: 1 }]);
    expect(findDetectorSpans(detectors, "2b")).toEqual([{ start: 0, end: 1 }]);
  });
});

describe("replaceSpans", () => {
  test("no spans returns the value itself", () => {
    const replace = vi.fn(() => "x");
    expect(replaceSpans("abc", [], replace)).toBe("abc");
    expect(replace).not.toHaveBeenCalled();
  });

  test("each span is replaced, with the text between spans kept", () => {
    const spans: Span[] = [
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ];
    const replace = vi.fn((match: string) => `[${match.length}]`);
    expect(replaceSpans("a12b3c4", spans, replace)).toBe("a[2]b3[1]4");
    expect(replace.mock.calls).toEqual([
      ["12", spans[0]],
      ["c", spans[1]],
    ]);
  });

  test("spans at both ends of the value replace the whole of it", () => {
    expect(replaceSpans("secret", [{ start: 0, end: 6 }], () => "[Redacted]")).toBe("[Redacted]");
  });

  test("replaces what findDetectorSpans finds", () => {
    const value = "card 4111 1111 and 5500";
    const spans = findDetectorSpans([{ pattern: /\d{4}( \d{4})?/ }], value);
    expect(replaceSpans(value, spans, () => "****")).toBe("card **** and ****");
  });
});
