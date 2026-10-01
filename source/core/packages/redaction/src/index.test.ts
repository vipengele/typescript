import { expect, test } from "vitest";
import { composePolicies, redact, secretKeys, type RedactionPolicy } from "./index";

test("redacts a value found under a matched key", () => {
  const policy: RedactionPolicy = { keys: ["password"] };

  expect(redact({ username: "alice", password: "hunter2" }, policy)).toStrictEqual({
    username: "alice",
    password: "[REDACTED]",
  });
});

test("redacts credential keys with the secretKeys policy", () => {
  expect(redact({ username: "alice", refresh_token: "abc" }, secretKeys)).toStrictEqual({
    username: "alice",
    refresh_token: "[REDACTED]",
  });
});

test("redacts the keys of every policy passed to composePolicies", () => {
  const policy = composePolicies(secretKeys, { keys: ["ssn"] });

  expect(redact({ ssn: "123", password: "hunter2", name: "alice" }, policy)).toStrictEqual({
    ssn: "[REDACTED]",
    password: "[REDACTED]",
    name: "alice",
  });
});
