import { describe, expect, test } from "vitest";
import { toAnyValue, toKeyValues } from "./any-value";

describe("toAnyValue", () => {
  test("encodes strings and booleans as themselves", () => {
    expect(toAnyValue("hi")).toEqual({ stringValue: "hi" });
    expect(toAnyValue(true)).toEqual({ boolValue: true });
    expect(toAnyValue(false)).toEqual({ boolValue: false });
  });

  test("encodes a safe integer as an intValue string and another finite number as a doubleValue", () => {
    expect(toAnyValue(42)).toEqual({ intValue: "42" });
    expect(toAnyValue(-7)).toEqual({ intValue: "-7" });
    expect(toAnyValue(-0)).toEqual({ intValue: "0" });
    expect(toAnyValue(Number.MAX_SAFE_INTEGER)).toEqual({ intValue: "9007199254740991" });
    expect(toAnyValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(toAnyValue(2 ** 60)).toEqual({ doubleValue: 2 ** 60 });
  });

  test("encodes NaN and the infinities as their text, which JSON cannot carry as numbers", () => {
    expect(toAnyValue(Number.NaN)).toEqual({ stringValue: "NaN" });
    expect(toAnyValue(Number.POSITIVE_INFINITY)).toEqual({ stringValue: "Infinity" });
    expect(toAnyValue(Number.NEGATIVE_INFINITY)).toEqual({ stringValue: "-Infinity" });
  });

  test("encodes a bigint within int64 as an intValue and one outside it as a stringValue", () => {
    const max = 2n ** 63n - 1n;
    const min = -(2n ** 63n);

    expect(toAnyValue(max)).toEqual({ intValue: max.toString() });
    expect(toAnyValue(min)).toEqual({ intValue: min.toString() });
    expect(toAnyValue(max + 1n)).toEqual({ stringValue: (max + 1n).toString() });
    expect(toAnyValue(min - 1n)).toEqual({ stringValue: (min - 1n).toString() });
  });

  test("encodes null and undefined as the empty value", () => {
    expect(toAnyValue(null)).toEqual({});
    expect(toAnyValue(undefined)).toEqual({});
  });

  test("encodes a symbol or a function as its text", () => {
    expect(toAnyValue(Symbol("s"))).toEqual({ stringValue: "Symbol(s)" });
    expect(toAnyValue(() => 1)).toEqual({ stringValue: "() => 1" });
  });

  test("encodes arrays and objects as nested arrayValue and kvlistValue", () => {
    expect(toAnyValue([1, "a", null, undefined, [true]])).toEqual({
      arrayValue: { values: [{ intValue: "1" }, { stringValue: "a" }, {}, {}, { arrayValue: { values: [{ boolValue: true }] } }] },
    });
    expect(toAnyValue({ a: 1, b: { c: "d" }, gone: undefined, empty: null })).toEqual({
      kvlistValue: {
        values: [
          { key: "a", value: { intValue: "1" } },
          { key: "b", value: { kvlistValue: { values: [{ key: "c", value: { stringValue: "d" } }] } } },
          { key: "empty", value: {} },
        ],
      },
    });
  });

  test("ends a cycle with a Circular marker, and encodes a shared non-cyclic object every time", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const shared = { x: 1 };
    const sharedValue = { kvlistValue: { values: [{ key: "x", value: { intValue: "1" } }] } };

    expect(toAnyValue(cyclic)).toEqual({
      kvlistValue: {
        values: [
          { key: "name", value: { stringValue: "loop" } },
          { key: "self", value: { stringValue: "[Circular]" } },
        ],
      },
    });
    expect(toAnyValue([shared, shared])).toEqual({ arrayValue: { values: [sharedValue, sharedValue] } });
  });
});

describe("toKeyValues", () => {
  test("encodes each entry in property order, leaving out undefined ones", () => {
    expect(toKeyValues({ b: "x", a: 2, skip: undefined })).toEqual([
      { key: "b", value: { stringValue: "x" } },
      { key: "a", value: { intValue: "2" } },
    ]);
  });

  test("treats the attributes record itself as on the path, so a self-reference is Circular", () => {
    const attributes: Record<string, unknown> = {};
    attributes.self = attributes;

    expect(toKeyValues(attributes)).toEqual([{ key: "self", value: { stringValue: "[Circular]" } }]);
  });
});
