import { expect, test } from "vitest";
import { redact, type RedactionPolicy } from "./index";

test("redacts a value found under a matched key", () => {
  const policy: RedactionPolicy = { keys: ["password"] };

  expect(redact({ username: "alice", password: "hunter2" }, policy)).toStrictEqual({
    username: "alice",
    password: "[REDACTED]",
  });
});
