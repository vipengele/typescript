import { secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test, vi } from "vitest";

// Node-only: under Node's module runner every read of a mocked module's export goes through the
// mock's getter, so the number of reads of the preset is observable. Chromium's mocked module
// reads each export once, when it is built, so the count says nothing there.

/** How many times the `secretKeys` preset has been read, through the mock below. */
const presetReads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@vipengele/ts-core-redaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vipengele/ts-core-redaction")>();
  return {
    ...actual,
    get secretKeys() {
      presetReads.count += 1;
      return actual.secretKeys;
    },
  };
});

describe("the default redaction", () => {
  test("loading the logger modules never reads the secretKeys preset", async () => {
    vi.resetModules();
    const before = presetReads.count;

    await import("./settings");
    await import("./builder");
    await import("./provider");
    await import("./logging");

    expect(presetReads.count).toBe(before);
  });

  test("is read when a build that sets no redaction is made, and only then", async () => {
    const { createLoggingBuilder } = await import("./builder");
    const before = presetReads.count;

    createLoggingBuilder().redaction(null).build();
    createLoggingBuilder()
      .redaction({ keys: ["ssn"] })
      .build();
    expect(presetReads.count).toBe(before);

    const { redaction } = createLoggingBuilder().build();
    expect(presetReads.count).toBe(before + 1);
    expect(redaction).toBe(secretKeys);
  });
});
