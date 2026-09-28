import { expect, test } from "vitest";
import { getScopeTree } from "./root";
import { Scope } from "./scope";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("an inherited scope survives an await inside fn under Node's own carrier", async () => {
  const afterAwait = await Scope.inherit("step", { "step.id": "s-1" }, async () => {
    await tick();
    return Scope.current();
  });

  expect(afterAwait.tag).toBe("step");
  expect(afterAwait.get("step.id")).toBe("s-1");
  expect(Scope.current()).toBe(getScopeTree().defaultScope);
});

test("a scope inherited after an await is a child of the scope current before it", async () => {
  const step = await Scope.isolated("request", { "user.id": "u-1" }, async () => {
    await tick();
    return Scope.inherit("step", {}, () => Scope.current());
  });

  expect(step.get("user.id")).toBe("u-1");
});

test("a propagated scope survives an await inside fn", async () => {
  const request = Scope.isolated("request", {}, () => Scope.current());

  const afterAwait = await Scope.propagate(request, async () => {
    await tick();
    return Scope.current();
  });

  expect(afterAwait).toBe(request);
});

test("two Units of Work interleaving across awaits each keep their own scope", async () => {
  async function unitOfWork(userId: string): Promise<unknown[]> {
    return Scope.isolated("request", { "user.id": userId }, async () => {
      const seen: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        await tick();
        seen.push(Scope.inherit("step", {}, () => Scope.current().get("user.id")));
      }
      return seen;
    });
  }

  const [a, b] = await Promise.all([unitOfWork("a"), unitOfWork("b")]);

  expect(a).toEqual(["a", "a", "a"]);
  expect(b).toEqual(["b", "b", "b"]);
});
