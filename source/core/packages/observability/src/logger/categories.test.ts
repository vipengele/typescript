import { describe, expect, test } from "vitest";
import { governingKeys, isCategory, isCategoryKey, ROOT_CATEGORY, validateCategory, validateCategoryKey } from "./categories";
import { isLoggingConfigError } from "./config-error";

const valid = ["react", "react.dom", "services.editing.cursor", "Services", "a-b_c.d1", "constructor", "__proto__", "café.ü"];
const invalidStrings = ["", ".", "a.", ".a", "a..b", "*", "a.*", "a*b", "a:b", "a,b", "*.a"];
const notStrings = [null, undefined, 1, {}, ["a"], Symbol.for("a")];

describe("isCategory", () => {
  test.for(valid)("accepts %j", (value) => {
    expect(isCategory(value)).toBe(true);
  });

  test.for(invalidStrings)("rejects %j", (value) => {
    expect(isCategory(value)).toBe(false);
  });

  test.for(notStrings)("rejects the non-string %o", (value) => {
    expect(isCategory(value)).toBe(false);
  });
});

describe("isCategoryKey", () => {
  test("accepts the root", () => {
    expect(ROOT_CATEGORY).toBe("*");
    expect(isCategoryKey("*")).toBe(true);
  });

  test.for(valid)("accepts the category %j", (value) => {
    expect(isCategoryKey(value)).toBe(true);
  });

  test.for(invalidStrings.filter((value) => value !== "*"))("rejects %j", (value) => {
    expect(isCategoryKey(value)).toBe(false);
  });

  test.for(notStrings)("rejects the non-string %o", (value) => {
    expect(isCategoryKey(value)).toBe(false);
  });
});

describe("validateCategory", () => {
  test("returns a valid category unchanged", () => {
    expect(validateCategory("react.dom")).toBe("react.dom");
  });

  test.for([...invalidStrings, ...notStrings])("throws a LoggingConfigError for %o", (value) => {
    expect(() => validateCategory(value)).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names a bad string in the message", () => {
    expect(() => validateCategory("a:b")).toThrow('Invalid logger category "a:b"');
  });

  test("names the type of a non-string in the message", () => {
    expect(() => validateCategory(null)).toThrow("Invalid logger category of type null");
    expect(() => validateCategory(1)).toThrow("Invalid logger category of type number");
  });
});

describe("validateCategoryKey", () => {
  test("returns the root and a category unchanged", () => {
    expect(validateCategoryKey("*")).toBe("*");
    expect(validateCategoryKey("react")).toBe("react");
  });

  test.for(["", "a..b", "a.*", "a:b", null])("throws a LoggingConfigError for %o", (value) => {
    expect(() => validateCategoryKey(value)).toThrow(expect.toSatisfy(isLoggingConfigError));
  });

  test("names a bad string in the message", () => {
    expect(() => validateCategoryKey("a,b")).toThrow('Invalid logger category "a,b"');
  });
});

describe("governingKeys", () => {
  test("walks dot-boundary prefixes, most specific first, ending at the root", () => {
    expect([...governingKeys("services.editing.cursor")]).toEqual(["services.editing.cursor", "services.editing", "services", "*"]);
  });

  test("a single segment yields itself and the root", () => {
    expect([...governingKeys("react")]).toEqual(["react", "*"]);
  });

  test("the root yields only itself", () => {
    expect([...governingKeys("*")]).toEqual(["*"]);
  });

  test("never yields a prefix that ends inside a segment", () => {
    expect([...governingKeys("reactive")]).toEqual(["reactive", "*"]);
    expect([...governingKeys("react.x")]).not.toContain("reactive");
  });
});
