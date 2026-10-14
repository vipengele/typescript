import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readEnvironmentSpec } from "./environment-source";
import { resolveSharedEntry } from "./slots";

// Node-only: the browser has no `process.env`, so `Logging` reading `VPG_LOG` end to end is only
// observable here. The environment-source suite covers the reader against injected sources in both
// runtimes.

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");
const registry = globalThis as unknown as Record<symbol, unknown>;

// The `process` global, typed for the one property this suite swaps; Biome bans both the bare
// global and a `node:process` import.
const nodeProcess = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process;

const originalEnv = nodeProcess.env;

/** How many times `VPG_LOG` has been read from the environment installed by {@link setEnvironment}. */
let reads = 0;

/** Replaces `process.env` with one holding `VPG_LOG` (unset when `undefined`) that counts its reads. */
function setEnvironment(value: string | undefined): void {
  reads = 0;
  const env: Record<string, string | undefined> = { ...originalEnv };
  delete env.VPG_LOG;
  if (value !== undefined) {
    env.VPG_LOG = value;
  }
  nodeProcess.env = new Proxy(env, {
    get(target, key, receiver) {
      if (key === "VPG_LOG") {
        reads += 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

let copies = 0;

/**
 * A fresh copy of the logging module. A distinct query string makes a distinct module instance, so
 * importing it is observed from scratch; the default provider still lives in the realm slot.
 */
async function freshCopy(): Promise<typeof import("./logging")> {
  copies += 1;
  const specifier = `./logging?copy=${copies}`;
  return import(/* @vite-ignore */ specifier);
}

beforeEach(() => {
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

afterEach(() => {
  nodeProcess.env = originalEnv;
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

describe("readEnvironmentSpec", () => {
  test("reads VPG_LOG from process.env by default", () => {
    setEnvironment("app:debug");
    expect(readEnvironmentSpec()).toBe("app:debug");

    setEnvironment(undefined);
    expect(readEnvironmentSpec()).toBeUndefined();
  });
});

describe("Logging and VPG_LOG", () => {
  test("is read once per realm: never on import or Logger creation, once on the first level check", async () => {
    setEnvironment("app:debug");

    const copy = await freshCopy();
    const log = copy.Logging.logger("app");
    expect(reads).toBe(0);

    expect(log.enabled("debug")).toBe(true);
    expect(reads).toBe(1);

    log.enabled("trace");
    copy.Logging.override("db", "info");
    copy.Logging.configure((b) => b.addLevels({ db: "error" }));
    copy.Logging.reset();
    (await freshCopy()).Logging.logger("app").enabled("debug");
    expect(reads).toBe(1);
  });

  test("a module-scope Logger sees it with no configure call, and the shared level table carries it", async () => {
    setEnvironment("app:debug,db:off");
    const copy = await freshCopy();
    const log = copy.Logging.logger("app.cache");

    expect(log.enabled("debug")).toBe(true);
    expect(log.enabled("trace")).toBe(false);
    expect(copy.Logging.logger("db").enabled("fatal")).toBe(false);
    expect(copy.Logging.logger("other").enabled("info")).toBe(false);
    expect(resolveSharedEntry("app")).toEqual({ level: "debug", severity: expect.any(Number) });
  });

  test("leaves the shared level table at the defaults when it is unset", async () => {
    setEnvironment(undefined);
    const copy = await freshCopy();

    expect(copy.Logging.logger("app").enabled("warn")).toBe(true);
    expect(Object.keys(registry[LEVELS_SLOT] as object)).toEqual(["*"]);
    expect(reads).toBe(1);
  });

  test("beats overrides, survives clearDefaults and reset, and only ignoreEnvironment removes it until the next configure", async () => {
    setEnvironment("app:debug");
    const { Logging } = await freshCopy();
    const log = Logging.logger("app");

    expect({ ...Logging.override("app", "error").layers.environment }).toEqual({ app: "debug" });
    expect(log.enabled("debug")).toBe(true);

    Logging.configure((b) => b.clearDefaults().addLevels({ app: "fatal" }));
    expect(log.enabled("debug")).toBe(true);

    expect({ ...Logging.reset().layers.environment }).toEqual({ app: "debug" });
    expect(log.enabled("debug")).toBe(true);

    Logging.configure((b) => b.ignoreEnvironment());
    expect(log.enabled("debug")).toBe(false);

    Logging.configure(() => {});
    expect(log.enabled("debug")).toBe(true);
  });

  test("a bad entry only warns, once, through the warn target naming VPG_LOG", async () => {
    setEnvironment("app:loud,db:debug");
    const copy = await freshCopy();
    const target = vi.fn();
    copy.setWarnTarget(target);

    const log = copy.Logging.logger("db");
    expect(log.enabled("debug")).toBe(true);
    log.enabled("debug");
    copy.Logging.reset();

    expect(target.mock.calls).toEqual([['VPG_LOG: Level spec entry "app:loud" is skipped: invalid level "loud".']]);
    copy.setWarnTarget(undefined);
  });

  test("a bad entry never throws into a level check, even through a throwing warn target", async () => {
    setEnvironment("app:loud");
    const copy = await freshCopy();
    copy.setWarnTarget(() => {
      throw new Error("warn target down");
    });

    expect(copy.Logging.logger("app").enabled("warn")).toBe(true);
    copy.setWarnTarget(undefined);
  });

  test("a created provider reads it too, apart from the default provider and the shared table", async () => {
    setEnvironment("app:trace");
    const { Logging } = await freshCopy();

    const provider = Logging.createProvider((b) => b.addLevels({ app: "error" }));
    expect(provider.logger("app").enabled("trace")).toBe(true);
    expect(Object.hasOwn(globalThis, LEVELS_SLOT)).toBe(false);

    const ignoring = Logging.createProvider((b) => b.ignoreEnvironment().addLevels({ app: "error" }));
    expect(ignoring.logger("app").enabled("warn")).toBe(false);
  });
});
