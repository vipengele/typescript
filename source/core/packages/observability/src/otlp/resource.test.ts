import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import { groupByResource, resourceAttributes, SEMCONV_SCHEMA_URL } from "./resource";

const EMPTY_RESOURCE: Resource = {
  "service.name": undefined,
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
};

test("SEMCONV_SCHEMA_URL names the targeted semantic-conventions version", () => {
  expect(SEMCONV_SCHEMA_URL).toBe("https://opentelemetry.io/schemas/1.37.0");
});

describe("resourceAttributes", () => {
  test("writes every key that holds a value in the reserved order, and leaves out the rest", () => {
    const resource: Resource = {
      "service.name": "s",
      "service.version": "1",
      "service.dist": "d",
      "deployment.environment.name": "prod",
      "process.runtime.name": "node",
      "process.runtime.version": "24",
      "os.type": "linux",
      "os.version": "6",
      "browser.name": "chrome",
      "browser.version": "140",
      "device.type": "desktop",
    };

    expect(resourceAttributes(resource).map(({ key }) => key)).toEqual(Object.keys(resource));
    expect(resourceAttributes({ ...EMPTY_RESOURCE, "os.type": "linux" })).toEqual([{ key: "os.type", value: { stringValue: "linux" } }]);
    expect(resourceAttributes(EMPTY_RESOURCE)).toEqual([]);
  });
});

describe("groupByResource", () => {
  const CHECKOUT: Resource = { ...EMPTY_RESOURCE, "service.name": "checkout" };
  const scopeOf = (entry: { scope: string }) => entry.scope;
  const encode = (entry: { value: string }) => entry.value;

  test("returns no groups for no entries", () => {
    expect(groupByResource([], scopeOf, encode)).toEqual([]);
  });

  test("groups by Resource value rather than identity, then by scope, in first-seen order", () => {
    const groups = groupByResource(
      [
        { resource: { ...CHECKOUT }, scope: "a", value: "1" },
        { resource: { ...EMPTY_RESOURCE }, scope: "b", value: "2" },
        { resource: { ...CHECKOUT }, scope: "b", value: "3" },
        { resource: { ...CHECKOUT }, scope: "a", value: "4" },
        { resource: { ...EMPTY_RESOURCE }, scope: "b", value: "5" },
      ],
      scopeOf,
      encode,
    );

    expect(groups.map(({ resource, scopes }) => [resource["service.name"], [...scopes]])).toEqual([
      [
        "checkout",
        [
          ["a", ["1", "4"]],
          ["b", ["3"]],
        ],
      ],
      [undefined, [["b", ["2", "5"]]]],
    ]);
  });

  test("keeps the first entry's Resource object for a group", () => {
    const first = { ...CHECKOUT };
    const [group] = groupByResource(
      [
        { resource: first, scope: "a", value: "1" },
        { resource: { ...CHECKOUT }, scope: "a", value: "2" },
      ],
      scopeOf,
      encode,
    );

    expect(group?.resource).toBe(first);
  });
});
