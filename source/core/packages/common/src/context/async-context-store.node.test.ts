import { expect, test } from "vitest";
import { createAsyncContextStore } from "./async-context-store";

test("a propagated value survives an await under Node's own carrier", async () => {
  const store = createAsyncContextStore("async-context-store-node-test", "default");

  const afterAwait = await store.propagate("installed", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return store.current();
  });

  expect(afterAwait).toBe("installed");
  expect(store.current()).toBe("default");
});
