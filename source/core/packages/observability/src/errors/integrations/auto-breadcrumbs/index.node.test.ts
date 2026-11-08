import { afterEach, expect, test } from "vitest";
import type { IntegrationHost } from "../../integration";
import { autoBreadcrumbs } from "./index";
import { activeOptions } from "./registry";

const host: IntegrationHost = { capture: () => "id", flush: async () => true };

const teardowns: (() => void)[] = [];

afterEach(() => {
  for (const teardown of teardowns.splice(0)) {
    teardown();
  }
});

test("in Node only console and fetch install; xhr, navigation and clicks are skipped silently", () => {
  const originalLog = globalThis.console.log;
  const originalFetch = globalThis.fetch;

  const teardown = autoBreadcrumbs().setup(host) as () => void;
  teardowns.push(teardown);

  expect(activeOptions("console")).toBeDefined();
  expect(activeOptions("fetch")).toBeDefined();
  expect(activeOptions("xhr")).toBeUndefined();
  expect(activeOptions("navigation")).toBeUndefined();
  expect(activeOptions("clicks")).toBeUndefined();
  expect(globalThis.console.log).not.toBe(originalLog);
  expect(globalThis.fetch).not.toBe(originalFetch);

  teardown();

  expect(globalThis.console.log).toBe(originalLog);
  expect(globalThis.fetch).toBe(originalFetch);
});
