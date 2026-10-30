import { describe, expect, it } from "vitest";
import { classify } from "./classify";
import type { StatusClass } from "./classify";

describe("classify", () => {
  it.each<[number, StatusClass]>([
    [200, "delivered"],
    [201, "delivered"],
    [204, "delivered"],
    [299, "delivered"],
    [408, "retry"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [599, "retry"],
    [100, "rejected"],
    [199, "rejected"],
    [300, "rejected"],
    [301, "rejected"],
    [304, "rejected"],
    [400, "rejected"],
    [401, "rejected"],
    [404, "rejected"],
    [413, "rejected"],
    [600, "rejected"],
    [0, "rejected"],
  ])("classifies %d as %s", (status, expected) => {
    expect(classify(status)).toBe(expected);
  });
});
