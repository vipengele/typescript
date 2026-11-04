import { describe, expect, test } from "vitest";
import { ENVIRONMENT_VARIABLE, parseEnvironmentSpec, readEnvironmentSpec } from "./environment-source";

describe("readEnvironmentSpec", () => {
  test("reads VPG_LOG from the source's process.env", () => {
    expect(ENVIRONMENT_VARIABLE).toBe("VPG_LOG");
    expect(readEnvironmentSpec({ process: { env: { VPG_LOG: "app:debug", OTHER: "x" } } })).toBe("app:debug");
    expect(readEnvironmentSpec({ process: { env: { VPG_LOG: "" } } })).toBe("");
  });

  test.for([
    ["no process", {}],
    ["a process without env", { process: {} }],
    ["an unset variable", { process: { env: { OTHER: "x" } } }],
    ["a value that is not a string", { process: { env: { VPG_LOG: 1 } } }],
  ] as const)("reads %s as undefined", ([, source]) => {
    expect(readEnvironmentSpec(source)).toBeUndefined();
  });

  test("reads an environment whose access throws as undefined", () => {
    const env = {
      get VPG_LOG(): string {
        throw new Error("Requires env access");
      },
    };

    expect(readEnvironmentSpec({ process: { env } })).toBeUndefined();
  });

  test("never throws without an injected source", () => {
    const value = readEnvironmentSpec();

    expect(value === undefined || typeof value === "string").toBe(true);
  });
});

describe("parseEnvironmentSpec", () => {
  test("parses the spec and names VPG_LOG in every issue", () => {
    const parsed = parseEnvironmentSpec("app:debug,bad,db:loud");

    expect({ ...parsed.levels }).toEqual({ app: "debug" });
    expect(parsed.issues).toEqual([
      'VPG_LOG: Level spec entry "bad" is skipped: expected "category:level" with exactly one ":".',
      'VPG_LOG: Level spec entry "db:loud" is skipped: invalid level "loud".',
    ]);
  });

  test("carries the rules the spec's modifiers set, naming VPG_LOG in a skipped modifier's issue", () => {
    const parsed = parseEnvironmentSpec("db:debug;sample=0.25;limit=nope");

    expect({ ...parsed.levels }).toEqual({ db: "debug" });
    expect({ ...parsed.policy.sample }).toEqual({ db: { rate: 0.25, upTo: "info" } });
    expect(Object.keys(parsed.policy.rateLimit)).toEqual([]);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatch(/^VPG_LOG: Level spec entry "db:debug;sample=0.25;limit=nope" keeps its level but skips modifier /);
  });

  test("an empty spec yields no levels and no issues", () => {
    const parsed = parseEnvironmentSpec("");

    expect(Object.keys(parsed.levels)).toEqual([]);
    expect(parsed.issues).toEqual([]);
  });
});
