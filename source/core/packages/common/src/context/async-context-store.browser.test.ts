import { expect, test } from "vitest";
import { createAsyncContextStore } from "./async-context-store";

test("a propagated value is lost after an await under the browser's synchronous fallback", async () => {
  const store = createAsyncContextStore("async-context-store-browser-test", "default");
  let beforeAwait: string | undefined;

  const afterAwait = await store.propagate("installed", async () => {
    beforeAwait = store.current();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return store.current();
  });

  expect(beforeAwait).toBe("installed");
  expect(afterAwait).toBe("default");
});
