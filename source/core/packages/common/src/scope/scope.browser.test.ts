import { expect, test } from "vitest";
import { getScopeTree } from "./root";
import { Scope } from "./scope";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("an inherited scope is lost after an await under the browser's synchronous fallback", async () => {
  let beforeAwait: Scope | undefined;

  const afterAwait = await Scope.inherit("step", {}, async () => {
    beforeAwait = Scope.current();
    await tick();
    return Scope.current();
  });

  expect(beforeAwait?.tag).toBe("step");
  expect(afterAwait).toBe(getScopeTree().defaultScope);
});

test("a scope inherited after an await hangs off the default scope, not the enclosing one", async () => {
  const step = await Scope.isolated("request", { "user.id": "u-1" }, async () => {
    await tick();
    return Scope.inherit("step", {}, () => Scope.current());
  });

  expect(step.get("user.id")).toBeUndefined();
});

test("a scope captured before an await is current again once propagated after it", async () => {
  const afterAwait = await Scope.isolated("request", { "user.id": "u-1" }, async () => {
    const request = Scope.current();
    await tick();
    return Scope.propagate(request, () => Scope.current().get("user.id"));
  });

  expect(afterAwait).toBe("u-1");
});
