import { expect, test } from "vitest";
import * as entry from "./index";
import type { AttributesInput, NormalizeAttributesOptions } from "./index";

test("the entry point loads", () => {
  expect(entry).toBeTypeOf("object");
});

test("normalizeAttributes is reachable through the entry point", () => {
  const input: AttributesInput = { when: new Date(0), name: "value" };
  const options: NormalizeAttributesOptions = { maxDepth: 6 };

  const result: entry.Attributes = entry.normalizeAttributes(input, options);
  const when: entry.AttributeValue | undefined = result.when;

  expect(result).toEqual({ when: "1970-01-01T00:00:00.000Z", name: "value" });
  expect(when).toBe("1970-01-01T00:00:00.000Z");
});
