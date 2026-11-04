import { describe, expect, test } from "vitest";
import { parseLevelSpec, parseSpec } from "./spec";

describe("parseSpec", () => {
  test("parses categories, the root and every threshold", () => {
    const { levels, issues } = parseSpec("*:warn,react:debug,a.b:off");
    expect({ ...levels }).toEqual({ "*": "warn", react: "debug", "a.b": "off" });
    expect(issues).toEqual([]);
  });

  test("returns a prototype-less object", () => {
    expect(Object.getPrototypeOf(parseSpec("a:info").levels)).toBeNull();
  });

  test.for(["", "   ", ",", " , ,", "a:info,"])("ignores empty entries without an issue in %j", (spec) => {
    expect(parseSpec(spec).issues).toEqual([]);
  });

  test("tolerates whitespace around entries and parts", () => {
    const { levels, issues } = parseSpec("  a : info ,\t*\n:\nwarn  ");
    expect({ ...levels }).toEqual({ a: "info", "*": "warn" });
    expect(issues).toEqual([]);
  });

  test("keeps the last duplicate and reports it", () => {
    const { levels, issues } = parseSpec("a:info,a:error");
    expect({ ...levels }).toEqual({ a: "error" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a:error");
  });

  test.for([
    ["missing colon", "react"],
    ["extra colon", "a:info:warn"],
    ["empty category", ":info"],
    ["invalid category", "a..b:info"],
    ["category with a star", "a.*:info"],
    ["empty level", "a:"],
    ["unknown level", "a:loud"],
    ["inherited level name", "a:constructor"],
    ["proto level", "a:__proto__"],
  ])("skips and names a bad entry: %s", ([, entry]) => {
    const { levels, issues } = parseSpec(`ok:info,${entry},*:warn`);
    expect({ ...levels }).toEqual({ ok: "info", "*": "warn" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(JSON.stringify(entry));
  });

  test("stores a __proto__ category as an own key", () => {
    const { levels, issues } = parseSpec("__proto__:debug");
    const key = "__proto__";
    expect(Object.hasOwn(levels, key)).toBe(true);
    expect(levels[key]).toBe("debug");
    expect(Object.getPrototypeOf(levels)).toBeNull();
    expect(({} as Record<string, unknown>).debug).toBeUndefined();
    expect(issues).toEqual([]);
  });

  test.for([undefined, null, 5, {}, ["a:info"]])("never throws for the non-string %o", (value) => {
    const { levels, policy, issues } = parseSpec(value as unknown as string);
    expect(Object.keys(levels)).toEqual([]);
    expect(policy).toEqual({ sample: {}, rateLimit: {} });
    expect(issues).toHaveLength(1);
  });

  test("describes null distinctly from other non-strings", () => {
    expect(parseSpec(null as unknown as string).issues[0]).toContain("null");
    expect(parseSpec(5 as unknown as string).issues[0]).toContain("number");
  });
});

describe("parseSpec modifiers", () => {
  test("a level-only spec sets no rule", () => {
    const { policy } = parseSpec("*:warn,react:debug");
    expect({ ...policy.sample }).toEqual({});
    expect({ ...policy.rateLimit }).toEqual({});
  });

  test("reads sample, limit and upto after the level, upto applying to both", () => {
    const { levels, policy, issues } = parseSpec("db:debug;sample=0.1;limit=20/60;upto=warn");

    expect({ ...levels }).toEqual({ db: "debug" });
    expect({ ...policy.sample }).toEqual({ db: { rate: 0.1, upTo: "warn" } });
    expect({ ...policy.rateLimit }).toEqual({ db: { burst: 20, perMinute: 60, upTo: "warn" } });
    expect(issues).toEqual([]);
  });

  test("a rule applies up to info unless upto says otherwise", () => {
    const { policy } = parseSpec("a:debug;sample=0.5,b:debug;limit=1/1");

    expect(policy.sample.a).toEqual({ rate: 0.5, upTo: "info" });
    expect(policy.rateLimit.b).toEqual({ burst: 1, perMinute: 1, upTo: "info" });
  });

  test("sample=1 and limit=off are kept as clearing rules", () => {
    const { policy, issues } = parseSpec("db.pool:debug;sample=1;limit=off");

    expect(policy.sample["db.pool"]).toEqual({ rate: 1, upTo: "info" });
    expect(policy.rateLimit["db.pool"]).toBe(false);
    expect(issues).toEqual([]);
  });

  test("tolerates whitespace and empty modifiers, and reads decimal and exponent figures", () => {
    const { levels, policy, issues } = parseSpec(" db : debug ; sample = .5 ;; limit = 1e1 / 2.5 ; ");

    expect({ ...levels }).toEqual({ db: "debug" });
    expect(policy.sample.db).toEqual({ rate: 0.5, upTo: "info" });
    expect(policy.rateLimit.db).toEqual({ burst: 10, perMinute: 2.5, upTo: "info" });
    expect(issues).toEqual([]);
  });

  test("returns frozen, prototype-less rule tables holding a __proto__ key as an own key", () => {
    const { policy } = parseSpec("__proto__:debug;sample=0.5;limit=2/2");

    expect(Object.isFrozen(policy)).toBe(true);
    for (const table of [policy.sample, policy.rateLimit]) {
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.getPrototypeOf(table)).toBeNull();
      expect(Object.hasOwn(table, "__proto__")).toBe(true);
    }
  });

  test.for([
    ["a rate above 1", "sample=2", 'sample "2" is not a rate from 0 to 1'],
    ["a negative rate", "sample=-0.5", "is not a rate from 0 to 1"],
    ["an empty rate", "sample=", 'sample "" is not a rate'],
    ["a hex rate", "sample=0x1", "is not a rate"],
    ["a word rate", "sample=half", "is not a rate"],
    ["a burst below 1", "limit=0.5/60", 'limit "0.5/60" is not "off" or "<burst>/<perMinute>"'],
    ["a zero perMinute", "limit=5/0", 'is not "off"'],
    ["a limit with no per-minute figure", "limit=5", 'is not "off"'],
    ["a limit with three figures", "limit=1/2/3", 'is not "off"'],
    ["a limit of words", "limit=a/b", 'is not "off"'],
    ["an infinite burst", "limit=1e999/1", 'is not "off"'],
    ["an infinite perMinute", "limit=1/1e999", 'is not "off"'],
    ["upto off", "sample=0.5;upto=off", 'upto "off" is not one of trace, debug, info, warn, error or fatal'],
    ["an unknown upto", "sample=0.5;upto=loud", 'upto "loud" is not one of'],
    ["an unknown modifier", "rate=0.5", 'unknown modifier "rate": expected sample, limit or upto'],
    ["a modifier without =", "sample", 'expected "name=value" with exactly one "="'],
    ["a modifier with two =", "sample=0.5=1", 'expected "name=value" with exactly one "="'],
  ])("skips a bad modifier and keeps the level: %s", ([, modifiers, reason]) => {
    const entry = `db:debug;${modifiers}`;
    const { levels, issues } = parseSpec(`ok:info,${entry}`);

    expect({ ...levels }).toEqual({ ok: "info", db: "debug" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(`Level spec entry ${JSON.stringify(entry)} keeps its level but skips modifier`);
    expect(issues[0]).toContain(reason);
  });

  test("a bad modifier leaves the entry's other modifiers in force", () => {
    const { policy, issues } = parseSpec("db:debug;sample=2;limit=3/6;upto=loud");

    expect(Object.keys(policy.sample)).toEqual([]);
    expect(policy.rateLimit.db).toEqual({ burst: 3, perMinute: 6, upTo: "info" });
    expect(issues).toHaveLength(2);
  });

  test("an upto with neither sample nor limit is reported and sets nothing", () => {
    const { levels, policy, issues } = parseSpec("db:debug;upto=warn");

    expect({ ...levels }).toEqual({ db: "debug" });
    expect({ ...policy.sample, ...policy.rateLimit }).toEqual({});
    expect(issues).toEqual([
      'Level spec entry "db:debug;upto=warn" keeps its level but skips modifier "upto=warn": the entry sets no sample or limit.',
    ]);
  });

  test("an upto whose sample is skipped is reported as applying to nothing", () => {
    const { issues } = parseSpec("db:debug;sample=7;upto=warn");

    expect(issues).toHaveLength(2);
    expect(issues[1]).toContain("the entry sets no sample or limit");
  });

  test("a modifier given twice keeps the last value and is reported", () => {
    const { policy, issues } = parseSpec("db:debug;sample=0.1;sample=0.2");

    expect(policy.sample.db).toEqual({ rate: 0.2, upTo: "info" });
    expect(issues).toEqual(['Level spec entry "db:debug;sample=0.1;sample=0.2" repeats modifier "sample": the last one wins.']);
  });

  test("a repeated category keeps the last entry's modifiers only", () => {
    const { levels, policy, issues } = parseSpec("db:debug;sample=0.1;limit=1/1,db:info;limit=2/2");

    expect({ ...levels }).toEqual({ db: "info" });
    expect(Object.keys(policy.sample)).toEqual([]);
    expect(policy.rateLimit.db).toEqual({ burst: 2, perMinute: 2, upTo: "info" });
    expect(issues).toHaveLength(1);
  });

  test("an entry with an invalid level is skipped whole, its modifiers with it", () => {
    const { levels, policy, issues } = parseSpec("db:loud;sample=0.5");

    expect(Object.keys(levels)).toEqual([]);
    expect(Object.keys(policy.sample)).toEqual([]);
    expect(issues).toEqual(['Level spec entry "db:loud;sample=0.5" is skipped: invalid level "loud".']);
  });

  test("a ; in the category is part of the category", () => {
    const { levels, issues } = parseSpec("a;b:debug");

    expect({ ...levels }).toEqual({ "a;b": "debug" });
    expect(issues).toEqual([]);
  });
});

describe("parseLevelSpec", () => {
  test("parses a level-only spec as parseSpec does", () => {
    expect({ ...parseLevelSpec("*:warn,a:debug").levels }).toEqual({ "*": "warn", a: "debug" });
  });

  test("reads everything after the : as the level, so a modifier makes the level invalid", () => {
    const { levels, policy, issues } = parseLevelSpec("db:debug;sample=0.5");

    expect(Object.keys(levels)).toEqual([]);
    expect(Object.keys(policy.sample)).toEqual([]);
    expect(issues).toEqual(['Level spec entry "db:debug;sample=0.5" is skipped: invalid level "debug;sample=0.5".']);
  });
});
