import type { Level } from "@vipengele/ts-core-common";
import { describe, expect, test, vi } from "vitest";
import { isLoggingConfigError } from "./config-error";
import {
  DEFAULT_POLICY_UP_TO,
  EMPTY_POLICY_LAYER,
  flattenPolicyLayers,
  freezePolicyLayer,
  freezeRateLimitRules,
  freezeSampleRules,
  LogPolicy,
  type PolicyLayerInput,
  type PolicyTable,
  resolveRateLimit,
  resolveSampling,
  validateRateLimitRule,
  validateSampleRule,
} from "./policy";

const isConfigError = expect.toSatisfy(isLoggingConfigError);

function tableOf(...layers: PolicyLayerInput[]): PolicyTable {
  return flattenPolicyLayers(layers.map(freezePolicyLayer));
}

function policyOf(...layers: PolicyLayerInput[]): LogPolicy {
  return new LogPolicy(tableOf(...layers));
}

const keepAll = () => 0;
const keepNone = () => 0.999;
const at = (time: number) => (): number => time;

describe("validateSampleRule", () => {
  test("a bare rate applies up to info", () => {
    expect(validateSampleRule(0.25, "db")).toEqual({ rate: 0.25, upTo: "info" });
    expect(DEFAULT_POLICY_UP_TO).toBe("info");
  });

  test("an object keeps its upTo and the result is frozen", () => {
    const setting = validateSampleRule({ rate: 0, upTo: "error" }, "db");
    expect(setting).toEqual({ rate: 0, upTo: "error" });
    expect(Object.isFrozen(setting)).toBe(true);
  });

  test.for([-0.1, 1.5, Number.NaN, "0.5", null, undefined, {}, { rate: "1" }, { rate: 2 }])(
    "throws a LoggingConfigError for %o",
    (rule) => {
      expect(() => validateSampleRule(rule, "db")).toThrow(isConfigError);
    },
  );

  test("names the key and the bad value", () => {
    expect(() => validateSampleRule(2, "db")).toThrow('Invalid logger sample rule for "db": rate 2 is not a number from 0 to 1.');
    expect(() => validateSampleRule({ rate: "x" }, "db")).toThrow('rate "x" is not');
    expect(() => validateSampleRule(null, "db")).toThrow("rate of type null is not");
  });

  test("rejects an upTo that is not a level", () => {
    expect(() => validateSampleRule({ rate: 0.5, upTo: "off" }, "db")).toThrow(
      'Invalid logger sample rule for "db" upTo "off": expected one of trace, debug, info, warn, error or fatal.',
    );
  });
});

describe("validateRateLimitRule", () => {
  test("false clears", () => {
    expect(validateRateLimitRule(false, "db")).toBe(false);
  });

  test("an object applies up to info unless it sets upTo, and is frozen", () => {
    const setting = validateRateLimitRule({ burst: 20, perMinute: 60 }, "db");
    expect(setting).toEqual({ burst: 20, perMinute: 60, upTo: "info" });
    expect(Object.isFrozen(setting)).toBe(true);
    expect(validateRateLimitRule({ burst: 1, perMinute: 0.5, upTo: "fatal" }, "db")).toEqual({ burst: 1, perMinute: 0.5, upTo: "fatal" });
  });

  test.for([true, 0, "20/60", null, undefined])("throws for the non-object %o", (rule) => {
    expect(() => validateRateLimitRule(rule, "db")).toThrow(isConfigError);
    expect(() => validateRateLimitRule(rule, "db")).toThrow("expected false or an object.");
  });

  test.for([
    { perMinute: 60 },
    { burst: 0.5, perMinute: 60 },
    { burst: Number.POSITIVE_INFINITY, perMinute: 60 },
    { burst: "2", perMinute: 60 },
  ])("rejects the burst of %o", (rule) => {
    expect(() => validateRateLimitRule(rule, "db")).toThrow(/burst .* is not a finite number of at least 1\./);
  });

  test.for([{ burst: 2 }, { burst: 2, perMinute: 0 }, { burst: 2, perMinute: Number.NaN }, { burst: 2, perMinute: "1" }])(
    "rejects the perMinute of %o",
    (rule) => {
      expect(() => validateRateLimitRule(rule, "db")).toThrow(/perMinute .* is not a positive finite number\./);
    },
  );

  test("rejects an upTo that is not a level", () => {
    expect(() => validateRateLimitRule({ burst: 1, perMinute: 1, upTo: "loud" }, "db")).toThrow(
      'Invalid logger rate limit for "db" upTo "loud"',
    );
  });
});

describe("freezeSampleRules, freezeRateLimitRules and freezePolicyLayer", () => {
  test("copy each own key into a frozen, prototype-less table", () => {
    const sample = freezeSampleRules({ "*": 0.5, db: { rate: 0.1, upTo: "debug" } });
    expect({ ...sample }).toEqual({ "*": { rate: 0.5, upTo: "info" }, db: { rate: 0.1, upTo: "debug" } });
    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.getPrototypeOf(sample)).toBeNull();

    const rateLimit = freezeRateLimitRules({ db: { burst: 2, perMinute: 6 }, "db.cache": false });
    expect({ ...rateLimit }).toEqual({ db: { burst: 2, perMinute: 6, upTo: "info" }, "db.cache": false });
  });

  test("a category key named __proto__ is an ordinary key", () => {
    const rules = Object.defineProperty({}, "__proto__", { value: 0.5, enumerable: true });
    expect(Object.keys(freezeSampleRules(rules))).toEqual(["__proto__"]);
  });

  test("throw for a non-object, an invalid key or an invalid rule", () => {
    expect(() => freezeSampleRules(null)).toThrow("Invalid logger sample rules of type null: expected an object keyed by category.");
    expect(() => freezeRateLimitRules(3)).toThrow("Invalid logger rate limit rules 3: expected an object keyed by category.");
    expect(() => freezeSampleRules({ "a:b": 0.5 })).toThrow(isConfigError);
    expect(() => freezeRateLimitRules({ db: true })).toThrow(isConfigError);
  });

  test("an omitted kind is empty, and the layer is frozen", () => {
    const layer = freezePolicyLayer({ sample: { db: 0.5 } });
    expect(layer.rateLimit).toBe(EMPTY_POLICY_LAYER.rateLimit);
    expect(Object.isFrozen(layer)).toBe(true);
    expect(freezePolicyLayer({}).sample).toBe(EMPTY_POLICY_LAYER.sample);
    expect(Object.keys(EMPTY_POLICY_LAYER.sample)).toEqual([]);
    expect(Object.isFrozen(EMPTY_POLICY_LAYER)).toBe(true);
  });

  test("a layer it produced passes through with the same content", () => {
    const layer = freezePolicyLayer({
      sample: { db: { rate: 0.5, upTo: "warn" } },
      rateLimit: { db: { burst: 2, perMinute: 6 }, x: false },
    });
    const again = freezePolicyLayer(layer);
    expect({ ...again.sample }).toEqual({ ...layer.sample });
    expect({ ...again.rateLimit }).toEqual({ ...layer.rateLimit });
  });
});

describe("flattenPolicyLayers", () => {
  test("a later layer replaces an earlier layer's rule of the same kind for the same key, and nothing else", () => {
    const table = tableOf(
      { sample: { db: 0.5, "*": 0.9 }, rateLimit: { db: { burst: 5, perMinute: 5 } } },
      { rateLimit: { db: { burst: 2, perMinute: 6 } } },
      { sample: { db: 0.1 } },
    );
    expect({ ...table.sample }).toEqual({ db: { rate: 0.1, upTo: "info" }, "*": { rate: 0.9, upTo: "info" } });
    expect(table.rateLimit.db).toMatchObject({ key: "db", burst: 2, perMinute: 6, upTo: "info" });
  });

  test("keeps clearing rules, freezes every table and entry, and leaves tables prototype-less", () => {
    const table = tableOf({ sample: { db: 1 }, rateLimit: { db: false, x: { burst: 1, perMinute: 1 } } });
    expect(table.sample.db).toEqual({ rate: 1, upTo: "info" });
    expect(table.rateLimit.db).toBe(false);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.sample)).toBe(true);
    expect(Object.isFrozen(table.rateLimit)).toBe(true);
    expect(Object.isFrozen(table.rateLimit.x)).toBe(true);
    expect(Object.getPrototypeOf(table.sample)).toBeNull();
    expect(Object.getPrototypeOf(table.rateLimit)).toBeNull();
  });

  test("names a rate-limit rule by its key and value", () => {
    const one = tableOf({ rateLimit: { db: { burst: 2, perMinute: 6 } } }).rateLimit.db;
    const same = tableOf({ rateLimit: { db: { burst: 2, perMinute: 6, upTo: "info" } } }).rateLimit.db;
    const otherKey = tableOf({ rateLimit: { api: { burst: 2, perMinute: 6 } } }).rateLimit.api;
    const otherUpTo = tableOf({ rateLimit: { db: { burst: 2, perMinute: 6, upTo: "warn" } } }).rateLimit.db;
    const ids = [one, same, otherKey, otherUpTo].map((entry) => (entry === false ? undefined : entry?.id));
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("resolveSampling and resolveRateLimit", () => {
  test("resolve by the longest governing key, then the root", () => {
    const table = tableOf({
      sample: { "*": 0.9, db: 0.5, "db.query": 0.1 },
      rateLimit: { db: { burst: 1, perMinute: 1 } },
    });
    expect(resolveSampling(table.sample, "db.query.slow")?.rate).toBe(0.1);
    expect(resolveSampling(table.sample, "db.pool")?.rate).toBe(0.5);
    expect(resolveSampling(table.sample, "dbx")?.rate).toBe(0.9);
    expect(resolveRateLimit(table.rateLimit, "db.query")?.key).toBe("db");
    expect(resolveRateLimit(table.rateLimit, "api")).toBeUndefined();
  });

  test("rate 1 and false clear an inherited rule for the key and its descendants", () => {
    const table = tableOf(
      { sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } },
      { sample: { "db.cache": 1 }, rateLimit: { "db.cache": false } },
    );
    expect(resolveSampling(table.sample, "db.cache.hit")).toBeUndefined();
    expect(resolveRateLimit(table.rateLimit, "db.cache")).toBeUndefined();
    expect(resolveSampling(table.sample, "db.query")?.rate).toBe(0.5);
    expect(resolveRateLimit(table.rateLimit, "db.query")?.key).toBe("db");
  });

  test("a key that sets only one kind of rule does not clear the other kind it inherits", () => {
    const table = tableOf({ sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } }, { sample: { "db.query": 0.2 } });
    expect(resolveRateLimit(table.rateLimit, "db.query")?.key).toBe("db");
  });

  test("only own properties count", () => {
    const table = tableOf({ sample: { db: 0.5 } });
    expect(resolveSampling(table.sample, "constructor")).toBeUndefined();
    expect(resolveSampling(table.sample, "toString.x")).toBeUndefined();
  });

  test("memoise per table identity", () => {
    const table = tableOf({ sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } });
    const hasOwn = vi.spyOn(Object, "hasOwn");
    try {
      const first = resolveSampling(table.sample, "db.query");
      const limit = resolveRateLimit(table.rateLimit, "db.query");
      const calls = hasOwn.mock.calls.length;
      expect(resolveSampling(table.sample, "db.query")).toBe(first);
      expect(resolveRateLimit(table.rateLimit, "db.query")).toBe(limit);
      expect(resolveSampling(table.sample, "unknown")).toBeUndefined();
      const afterMiss = hasOwn.mock.calls.length;
      expect(resolveSampling(table.sample, "unknown")).toBeUndefined();
      expect(hasOwn.mock.calls.length).toBe(afterMiss);
      expect(afterMiss).toBeGreaterThan(calls);

      const replaced = tableOf({ sample: { db: 0.25 } });
      expect(resolveSampling(replaced.sample, "db.query")?.rate).toBe(0.25);
    } finally {
      hasOwn.mockRestore();
    }
  });
});

describe("LogPolicy#admit", () => {
  test("admits every call when no rule governs the category, without reading the clock or random", () => {
    const random = vi.fn(keepNone);
    const clock = vi.fn(at(0));
    const admission = policyOf({ sample: { api: 0 } }).admit("db", "trace", random, clock);
    expect(admission).toEqual({ time: undefined, dropped: 0, settle: expect.any(Function) });
    admission?.settle();
    expect(random).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  test("samples by drawing random against the rate", () => {
    const policy = policyOf({ sample: { db: 0.5 } });
    expect(policy.admit("db", "debug", () => 0.49, at(0))).toBeDefined();
    expect(policy.admit("db", "debug", () => 0.5, at(0))).toBeUndefined();
    expect(policyOf({ sample: { db: 0 } }).admit("db", "debug", keepAll, at(0))).toBeUndefined();
  });

  test("a key with a sample rate of 1 overrides the root and never draws", () => {
    const random = vi.fn(keepNone);
    expect(policyOf({ sample: { "*": 0.5, db: 1 } }).admit("db.x", "debug", random, at(0))).toBeDefined();
    expect(random).not.toHaveBeenCalled();
  });

  test.for<[Level, boolean]>([
    ["trace", false],
    ["debug", false],
    ["info", false],
    ["warn", true],
    ["error", true],
    ["fatal", true],
  ])("by default a rule leaves %s passing: %s", ([level, passes]) => {
    const policy = policyOf({ sample: { db: 0 }, rateLimit: { api: { burst: 1, perMinute: 1 } } });
    expect(policy.admit("db", level, keepAll, at(0)) !== undefined).toBe(passes);
    policy.admit("api", level, keepAll, at(0));
    expect(policy.admit("api", level, keepAll, at(0)) !== undefined).toBe(passes);
  });

  test("upTo moves the highest level a rule applies to", () => {
    const policy = policyOf({
      sample: { db: { rate: 0, upTo: "debug" }, all: { rate: 0, upTo: "fatal" } },
      rateLimit: { api: { burst: 1, perMinute: 1, upTo: "error" } },
    });
    expect(policy.admit("db", "debug", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("db", "info", keepAll, at(0))).toBeDefined();
    expect(policy.admit("all", "fatal", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("api", "error", keepAll, at(0))).toBeDefined();
    expect(policy.admit("api", "error", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("api", "fatal", keepAll, at(0))).toBeDefined();
  });

  test("an exempt level reads neither random nor the clock", () => {
    const random = vi.fn(keepNone);
    const clock = vi.fn(at(0));
    const admission = policyOf({ sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } }).admit("db", "warn", random, clock);
    expect(admission?.time).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  test("the rate limit reads the clock once and hands its time to the admission", () => {
    const clock = vi.fn(at(1234.5));
    const admission = policyOf({ rateLimit: { db: { burst: 1, perMinute: 1 } } }).admit("db", "info", keepAll, clock);
    expect(admission?.time).toBe(1234.5);
    expect(admission?.dropped).toBe(0);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  test("samples first: a sampled-out call takes no token, reads no clock and is not counted", () => {
    const policy = policyOf({ sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } });
    const clock = vi.fn(at(0));
    expect(policy.admit("db", "debug", keepNone, clock)).toBeUndefined();
    expect(clock).not.toHaveBeenCalled();
    const admission = policy.admit("db", "debug", keepAll, at(0));
    expect(admission).toMatchObject({ time: 0, dropped: 0 });
  });

  test("one bucket serves every category the rule governs", () => {
    const policy = policyOf({ rateLimit: { db: { burst: 2, perMinute: 60 } } });
    expect(policy.admit("db.query", "debug", keepAll, at(0))).toBeDefined();
    expect(policy.admit("db.pool", "debug", keepAll, at(0))).toBeDefined();
    expect(policy.admit("db", "debug", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("db.query", "debug", keepAll, at(1000))).toBeDefined();
  });

  test("a cleared descendant has no bucket and does not drain its parent's", () => {
    const policy = policyOf({ rateLimit: { db: { burst: 1, perMinute: 1 }, "db.cache": false } });
    expect(policy.states.size).toBe(1);
    for (let i = 0; i < 5; i++) {
      expect(policy.admit("db.cache", "debug", keepAll, at(0))).toBeDefined();
    }
    expect(policy.admit("db", "debug", keepAll, at(0))).toBeDefined();
  });

  test("counts rate-limit drops per rule and reports them on the rule's next admission, whatever its category", () => {
    const policy = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 }, api: { burst: 1, perMinute: 60 } } });
    policy.admit("db.query", "debug", keepAll, at(0));
    expect(policy.admit("db.query", "debug", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("db.query", "debug", keepAll, at(0))).toBeUndefined();
    expect(policy.admit("api", "debug", keepAll, at(0))?.dropped).toBe(0);

    const admission = policy.admit("db.pool", "debug", keepAll, at(1000));
    expect(admission?.dropped).toBe(2);
    admission?.settle();
    expect(policy.admit("db.pool", "debug", keepAll, at(2000))?.dropped).toBe(0);
  });

  test("keeps the count until the admission is settled, and settling twice subtracts once", () => {
    const policy = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 } } });
    policy.admit("db", "debug", keepAll, at(0))?.settle();
    policy.admit("db", "debug", keepAll, at(0));

    const unsettled = policy.admit("db", "debug", keepAll, at(1000));
    expect(unsettled?.dropped).toBe(1);
    const next = policy.admit("db", "debug", keepAll, at(2000));
    expect(next?.dropped).toBe(1);

    policy.admit("db", "debug", keepAll, at(2000));
    next?.settle();
    next?.settle();
    expect(policy.admit("db", "debug", keepAll, at(3000))?.dropped).toBe(1);
  });

  test("a throwing clock drops silently, takes no token and is not counted", () => {
    const policy = policyOf({ rateLimit: { db: { burst: 1, perMinute: 1 } } });
    expect(
      policy.admit("db", "debug", keepAll, () => {
        throw new Error("clock");
      }),
    ).toBeUndefined();
    expect(policy.admit("db", "debug", keepAll, at(0))).toMatchObject({ dropped: 0 });
  });

  test("a throwing random drops silently and takes no token", () => {
    const policy = policyOf({ sample: { db: 0.5 }, rateLimit: { db: { burst: 1, perMinute: 1 } } });
    expect(
      policy.admit(
        "db",
        "debug",
        () => {
          throw new Error("random");
        },
        at(0),
      ),
    ).toBeUndefined();
    expect(policy.admit("db", "debug", keepAll, at(0))).toMatchObject({ dropped: 0 });
  });
});

describe("LogPolicy state across a rebuild", () => {
  test("a rule with the same key and value keeps its bucket and dropped count", () => {
    const before = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 } } });
    before.admit("db", "debug", keepAll, at(0));
    before.admit("db", "debug", keepAll, at(0));

    const after = new LogPolicy(
      tableOf({ sample: { api: 0.5 } }, { rateLimit: { db: { burst: 1, perMinute: 60, upTo: "info" } } }),
      before,
    );
    expect(after.admit("db", "debug", keepAll, at(0))).toBeUndefined();
    expect(after.admit("db", "debug", keepAll, at(1000))?.dropped).toBe(2);
  });

  test("a changed rule starts with a full bucket and no drops", () => {
    const before = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 }, api: { burst: 1, perMinute: 60 } } });
    before.admit("db", "debug", keepAll, at(0));
    before.admit("db", "debug", keepAll, at(0));
    before.admit("api", "debug", keepAll, at(0));

    const after = new LogPolicy(
      tableOf({ rateLimit: { db: { burst: 1, perMinute: 30 }, api: { burst: 1, perMinute: 60, upTo: "warn" } } }),
      before,
    );
    expect(after.admit("db", "debug", keepAll, at(0))).toMatchObject({ dropped: 0 });
    expect(after.admit("api", "debug", keepAll, at(0))).toBeDefined();
  });

  test("a rule moved to another key is a different rule", () => {
    const before = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 } } });
    before.admit("db", "debug", keepAll, at(0));

    const after = new LogPolicy(tableOf({ rateLimit: { "db.query": { burst: 1, perMinute: 60 } } }), before);
    expect(after.admit("db.query", "debug", keepAll, at(0))).toBeDefined();
  });

  test("a rule cleared and later restored starts afresh", () => {
    const before = policyOf({ rateLimit: { db: { burst: 1, perMinute: 60 } } });
    before.admit("db", "debug", keepAll, at(0));
    const cleared = new LogPolicy(tableOf({ rateLimit: { db: false } }), before);
    expect(cleared.states.size).toBe(0);

    const restored = new LogPolicy(tableOf({ rateLimit: { db: { burst: 1, perMinute: 60 } } }), cleared);
    expect(restored.admit("db", "debug", keepAll, at(0))).toBeDefined();
  });
});
