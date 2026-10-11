import { detectRuntime, type Runtime, type RuntimeSource } from "@vipengele/ts-core-common/runtime";
import type { Resource } from "@vipengele/ts-core-common/scope";

/** The Resource keys the environment can answer for; the service and deployment keys only an application can. */
export type RuntimeContextKey =
  | "process.runtime.name"
  | "process.runtime.version"
  | "os.type"
  | "os.version"
  | "browser.name"
  | "browser.version"
  | "device.type";

/** The detected slice of a {@link Resource}: a key is present only when it was detected, never `undefined`. */
export type RuntimeContext = { readonly [K in RuntimeContextKey & keyof Resource]?: string };

/**
 * Where runtime-context facts are looked up: `globalThis` by default, a plain object in a test that
 * forces a runtime the suite does not run in. Every member is `unknown` below its name because a
 * runtime, a polyfill or a fake can put anything there, and is type-checked before it is used. The
 * `process` slice is structural because the package type-checks without `@types/node`.
 */
export interface RuntimeContextSource extends RuntimeSource {
  readonly navigator?:
    | {
        readonly userAgent?: unknown;
        readonly sendBeacon?: unknown;
        readonly maxTouchPoints?: unknown;
        readonly userAgentData?:
          | {
              readonly brands?: unknown;
              readonly mobile?: unknown;
              readonly platform?: unknown;
            }
          | undefined;
      }
    | undefined;
  readonly process?:
    | {
        readonly getBuiltinModule?: unknown;
        readonly version?: unknown;
        readonly platform?: unknown;
        readonly versions?: { readonly node?: unknown } | undefined;
        readonly env?: Readonly<Record<string, unknown>> | undefined;
        readonly stdout?: { readonly isTTY?: unknown } | undefined;
        readonly on?: unknown;
      }
    | undefined;
}

type UserAgentData = NonNullable<NonNullable<RuntimeContextSource["navigator"]>["userAgentData"]>;

type MutableContext = { -readonly [K in keyof RuntimeContext]: RuntimeContext[K] };

/** A runtime that defines a real `process`; anywhere else a `process` is a bundler's polyfill. */
const PROCESS_RUNTIMES: ReadonlySet<Runtime> = new Set(["node", "bun", "deno", "edge"]);

/** `process.platform` values mapped to OpenTelemetry's `os.type`; any other platform is reported as-is. */
const PLATFORM_OS_TYPES: Readonly<Record<string, string>> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
  freebsd: "freebsd",
  openbsd: "openbsd",
  netbsd: "netbsd",
  aix: "aix",
  sunos: "solaris",
};

/** `navigator.userAgentData.platform` values mapped to the `os.type` the user-agent string yields. */
const UA_DATA_OS_TYPES: Readonly<Record<string, string>> = {
  Windows: "windows",
  macOS: "darwin",
  Linux: "linux",
  Android: "android",
  iOS: "ios",
  "Chrome OS": "chromeos",
  "Chromium OS": "chromeos",
};

/** `navigator.userAgentData.brands` entries naming a browser; `Chromium` and GREASE brands name none. */
const UA_DATA_BROWSERS: Readonly<Record<string, string>> = {
  "Google Chrome": "Chrome",
  "Microsoft Edge": "Edge",
  Opera: "Opera",
};

/** The Windows release each frozen `Windows NT` version names; Windows 11 still sends `10.0`. */
const WINDOWS_VERSIONS: Readonly<Record<string, string>> = {
  "10.0": "10",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.2": "XP",
  "5.1": "XP",
};

/**
 * Browser tokens in match order. Edge and Opera carry `Chrome/` too, and Chrome carries `Safari/`,
 * so each is ruled out before the one it imitates. `EdgiOS`, `EdgA`, `CriOS` and `FxiOS` are the
 * iOS and Android spellings, whose engine is WebKit on iOS whatever the name; headless Chromium
 * reads as Chrome.
 */
const BROWSER_PATTERNS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ["Edge", /\b(?:Edge|Edg|EdgA|EdgiOS)\/([\d.]+)/],
  ["Opera", /\b(?:OPR|OPT)\/([\d.]+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Chrome", /\b(?:Chrome|CriOS|HeadlessChrome)\/([\d.]+)/],
  ["Safari", /\bVersion\/([\d.]+).*\bSafari\//],
];

/** Reads a value, treating a throwing getter as an absent one. */
function read<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function runtimeVersion(runtime: Runtime, source: RuntimeContextSource): string | undefined {
  if (runtime === "bun") {
    return nonEmptyString(read(() => (source.Bun as { version?: unknown }).version));
  }
  if (runtime === "deno") {
    return nonEmptyString(read(() => (source.Deno as { version?: { deno?: unknown } }).version?.deno));
  }
  return nonEmptyString(read(() => source.process?.version))?.replace(/^v/, "");
}

function detectProcess(runtime: Runtime, source: RuntimeContextSource, context: MutableContext): void {
  const version = runtimeVersion(runtime, source);
  if (version !== undefined) {
    context["process.runtime.version"] = version;
  }
  const platform = nonEmptyString(read(() => source.process?.platform));
  if (platform !== undefined) {
    context["os.type"] = PLATFORM_OS_TYPES[platform] ?? platform;
  }
}

interface Os {
  readonly type: string;
  readonly version?: string;
}

function parseOs(userAgent: string, maxTouchPoints: unknown): Os | undefined {
  const windows = /\bWindows NT (\d+\.\d+)/.exec(userAgent);
  if (windows !== null) {
    const version = WINDOWS_VERSIONS[windows[1] as string];
    return version === undefined ? { type: "windows" } : { type: "windows", version };
  }
  const ios = /\b(?:iPhone|iPad|iPod)\b.*? OS (\d+(?:_\d+)*)/.exec(userAgent);
  if (ios !== null) {
    return { type: "ios", version: (ios[1] as string).replaceAll("_", ".") };
  }
  const mac = /\bMac OS X (\d+(?:[_.]\d+)*)/.exec(userAgent);
  if (mac !== null) {
    if (typeof maxTouchPoints === "number" && maxTouchPoints > 1) {
      return { type: "ios" };
    }
    return { type: "darwin", version: (mac[1] as string).replaceAll("_", ".") };
  }
  const android = /\bAndroid (\d+(?:\.\d+)*)/.exec(userAgent);
  if (android !== null) {
    return { type: "android", version: android[1] as string };
  }
  const chromeos = /\bCrOS \S+ (\d+(?:\.\d+)*)/.exec(userAgent);
  if (chromeos !== null) {
    return { type: "chromeos", version: chromeos[1] as string };
  }
  if (/\bLinux\b/.test(userAgent)) {
    return { type: "linux" };
  }
  return undefined;
}

function parseDevice(userAgent: string, os: Os): string {
  if (os.type === "ios") {
    return /\b(?:iPhone|iPod)\b/.test(userAgent) ? "mobile" : "tablet";
  }
  if (os.type === "android") {
    return /\bMobile\b/.test(userAgent) ? "mobile" : "tablet";
  }
  return "desktop";
}

function parseUserAgent(userAgent: string, maxTouchPoints: unknown, context: MutableContext): void {
  for (const [name, pattern] of BROWSER_PATTERNS) {
    const match = pattern.exec(userAgent);
    if (match !== null) {
      context["browser.name"] = name;
      context["browser.version"] = match[1] as string;
      break;
    }
  }
  const os = parseOs(userAgent, maxTouchPoints);
  if (os !== undefined) {
    context["os.type"] = os.type;
    if (os.version !== undefined) {
      context["os.version"] = os.version;
    }
    context["device.type"] = parseDevice(userAgent, os);
  }
}

function brandBrowser(brands: unknown): { name: string; version: string } | undefined {
  if (!Array.isArray(brands)) {
    return undefined;
  }
  for (const entry of brands as readonly unknown[]) {
    const brand = read(() => (entry as { brand?: unknown }).brand);
    const version = nonEmptyString(read(() => (entry as { version?: unknown }).version));
    const name = typeof brand === "string" ? UA_DATA_BROWSERS[brand] : undefined;
    if (name !== undefined && version !== undefined) {
      return { name, version };
    }
  }
  return undefined;
}

/**
 * Applies the low-entropy `navigator.userAgentData` hints over what the user-agent string gave. A
 * brand outranks the string's browser, keeping the string's fuller version when both agree on the
 * name; the platform outranks the string's OS type, dropping an OS version that no longer matches and
 * reading the device as a tablet on Android or iOS and a desktop elsewhere; `mobile: true` marks the
 * device mobile whatever the rest says.
 */
function applyUserAgentData(data: UserAgentData, context: MutableContext): void {
  const browser = brandBrowser(read(() => data.brands));
  if (browser !== undefined && context["browser.name"] !== browser.name) {
    context["browser.name"] = browser.name;
    context["browser.version"] = browser.version;
  }
  const platform = read(() => data.platform);
  const osType = typeof platform === "string" ? UA_DATA_OS_TYPES[platform] : undefined;
  if (osType !== undefined && context["os.type"] !== osType) {
    context["os.type"] = osType;
    delete context["os.version"];
    context["device.type"] = osType === "android" || osType === "ios" ? "tablet" : "desktop";
  }
  if (read(() => data.mobile) === true) {
    context["device.type"] = "mobile";
  }
}

function detectBrowser(source: RuntimeContextSource, context: MutableContext): void {
  const navigator = read(() => source.navigator);
  const userAgent = nonEmptyString(read(() => navigator?.userAgent));
  if (userAgent !== undefined) {
    parseUserAgent(
      userAgent,
      read(() => navigator?.maxTouchPoints),
      context,
    );
  }
  const data = read(() => navigator?.userAgentData);
  if (data !== undefined && data !== null) {
    applyUserAgentData(data, context);
  }
}

/**
 * The runtime, operating system, browser and device the code is running on, as the Resource keys
 * that describe them. Synchronous, dependency-free, best-effort: it never throws, a getter that
 * throws reads as absent, and a key it cannot detect is left out of the frozen result.
 *
 * `process.runtime.name` is {@link detectRuntime}'s answer (`node`, `bun`, `deno`, `edge`, `worker`,
 * `browser`), left out when that is `unknown`.
 *
 * In Node, Bun, Deno and an edge runtime, `process.runtime.version` is the runtime's own version
 * without a leading `v` (`Bun.version` and `Deno.version.deno`, whose `process.version` names the
 * Node release they imitate; `process.version` elsewhere), and `os.type` is `process.platform` in
 * OpenTelemetry's vocabulary (`win32` is `windows`, `sunos` is `solaris`, an unlisted platform as-is).
 * `os.version` is never set there: the OS release is only readable through `node:os`. The browser
 * keys are never set there either, since their `navigator.userAgent` names the runtime.
 *
 * Anywhere else — a browser, a worker, an unidentified runtime — `process` is never read, since a
 * bundler's polyfill is all it can be, and the browser keys come from `navigator.userAgent`:
 * `browser.name` is `Chrome`, `Edge`, `Firefox`, `Safari` or `Opera`, with the version the string
 * carries; `os.type` is `windows`, `darwin` (macOS, matching Node's), `ios`, `android`, `chromeos` or
 * `linux`; `device.type` is `mobile`, `tablet` or `desktop`, set whenever `os.type` is. When the
 * synchronous `navigator.userAgentData` is present its brand, platform and `mobile` flag outrank the
 * string; `getHighEntropyValues` is never called, so its versions stay major-only.
 *
 * What the string cannot guarantee:
 * - Chromium freezes the OS version it reports: macOS is always `10.15.7`, Windows 10 and 11 are both
 *   `10`, Android is often `10`. Safari freezes macOS at `10.15.7` too.
 * - iPadOS sends a Mac user agent. When the source's `navigator.maxTouchPoints` is above 1 a Mac
 *   string is read as `ios` on a `tablet`, with no OS version; without it an iPad reads as `darwin`
 *   on a `desktop`.
 * - "Request Desktop Site" sends a desktop string, so a phone using it reads as a desktop unless
 *   `userAgentData.mobile` says otherwise.
 * - A browser that spoofs or rewrites its user agent is reported as whatever it claims to be.
 */
export function detectRuntimeContext(source?: RuntimeContextSource): RuntimeContext {
  const context: MutableContext = {};
  const runtime = read(() => (source === undefined ? detectRuntime() : detectRuntime(source))) ?? "unknown";
  const from = source ?? (globalThis as RuntimeContextSource);
  if (runtime !== "unknown") {
    context["process.runtime.name"] = runtime;
  }
  if (PROCESS_RUNTIMES.has(runtime)) {
    detectProcess(runtime, from, context);
  } else {
    detectBrowser(from, context);
  }
  return Object.freeze(context);
}
