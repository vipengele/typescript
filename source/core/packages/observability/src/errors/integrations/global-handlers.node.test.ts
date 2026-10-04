import { expect, it } from "vitest";
import type { IntegrationHost } from "../integration";
import { globalHandlers } from "./global-handlers";

const { process } = globalThis as unknown as {
  process: { listenerCount(event: "uncaughtException" | "unhandledRejection"): number };
};

// Only registration is exercised on the real process: emitting `uncaughtException` or
// `unhandledRejection` here would reach Vitest's own listeners, which fail the run.
it("listens on the real process when nothing is injected, and removes both listeners on teardown", () => {
  const host: IntegrationHost = { capture: () => "id", flush: async () => true };
  const before = {
    uncaught: process.listenerCount("uncaughtException"),
    rejection: process.listenerCount("unhandledRejection"),
  };

  const teardown = globalHandlers({ onUncaught: "exit", onUnhandledRejection: "exit" }).setup(host);

  expect(process.listenerCount("uncaughtException")).toBe(before.uncaught + 1);
  expect(process.listenerCount("unhandledRejection")).toBe(before.rejection + 1);

  expect(teardown).toBeTypeOf("function");
  (teardown as () => void)();

  expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
  expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
});
