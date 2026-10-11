import { describe, expect, it } from "vitest";
import { detectRuntimeContext, type RuntimeContextSource } from "./runtime-context";

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/120.0.2210.91`;
const LEGACY_EDGE = `${CHROME_WINDOWS} Edge/18.17763`;
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
const FIREFOX_WINDOWS_7 = "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
const OPERA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const CHROME_ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const FIREFOX_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15";
const EDGE_IPOD =
  "Mozilla/5.0 (iPod touch; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.126 Mobile/15E148 Safari/605.1.15";
const IOS_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const CHROME_OS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** A browser main thread whose navigator carries `navigator`'s members. */
function browser(navigator: NonNullable<RuntimeContextSource["navigator"]>): RuntimeContextSource {
  return { window: {}, document: {}, navigator };
}

describe("detectRuntimeContext in a browser", () => {
  it.each([
    [
      "Chrome on Windows",
      CHROME_WINDOWS,
      { "browser.name": "Chrome", "browser.version": "120.0.0.0", "os.type": "windows", "os.version": "10", "device.type": "desktop" },
    ],
    [
      "Edge on Windows",
      EDGE_WINDOWS,
      { "browser.name": "Edge", "browser.version": "120.0.2210.91", "os.type": "windows", "os.version": "10", "device.type": "desktop" },
    ],
    [
      "EdgeHTML on Windows",
      LEGACY_EDGE,
      { "browser.name": "Edge", "browser.version": "18.17763", "os.type": "windows", "os.version": "10", "device.type": "desktop" },
    ],
    [
      "Firefox on Linux",
      FIREFOX_LINUX,
      { "browser.name": "Firefox", "browser.version": "121.0", "os.type": "linux", "device.type": "desktop" },
    ],
    [
      "Firefox on Windows 7",
      FIREFOX_WINDOWS_7,
      { "browser.name": "Firefox", "browser.version": "115.0", "os.type": "windows", "os.version": "7", "device.type": "desktop" },
    ],
    [
      "Safari on macOS",
      SAFARI_MAC,
      { "browser.name": "Safari", "browser.version": "17.2", "os.type": "darwin", "os.version": "10.15.7", "device.type": "desktop" },
    ],
    [
      "Opera on macOS",
      OPERA_MAC,
      { "browser.name": "Opera", "browser.version": "106.0.0.0", "os.type": "darwin", "os.version": "10.15.7", "device.type": "desktop" },
    ],
    [
      "Chrome on an Android phone",
      CHROME_ANDROID,
      { "browser.name": "Chrome", "browser.version": "120.0.0.0", "os.type": "android", "os.version": "10", "device.type": "mobile" },
    ],
    [
      "Chrome on an Android tablet",
      CHROME_ANDROID_TABLET,
      { "browser.name": "Chrome", "browser.version": "120.0.0.0", "os.type": "android", "os.version": "13", "device.type": "tablet" },
    ],
    [
      "Safari on an iPhone",
      SAFARI_IPHONE,
      { "browser.name": "Safari", "browser.version": "17.2", "os.type": "ios", "os.version": "17.2", "device.type": "mobile" },
    ],
    [
      "Chrome on an iPhone",
      CHROME_IPHONE,
      { "browser.name": "Chrome", "browser.version": "120.0.6099.119", "os.type": "ios", "os.version": "17.2", "device.type": "mobile" },
    ],
    [
      "Firefox on an iPad",
      FIREFOX_IPAD,
      { "browser.name": "Firefox", "browser.version": "121.0", "os.type": "ios", "os.version": "17.2", "device.type": "tablet" },
    ],
    [
      "Edge on an iPod touch",
      EDGE_IPOD,
      { "browser.name": "Edge", "browser.version": "120.0.2210.126", "os.type": "ios", "os.version": "17.2", "device.type": "mobile" },
    ],
    ["an iOS web view naming no browser", IOS_WEBVIEW, { "os.type": "ios", "os.version": "17.2", "device.type": "mobile" }],
    [
      "Chrome on ChromeOS",
      CHROME_OS,
      {
        "browser.name": "Chrome",
        "browser.version": "120.0.0.0",
        "os.type": "chromeos",
        "os.version": "14541.0.0",
        "device.type": "desktop",
      },
    ],
    [
      "headless Chromium on Linux",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36",
      { "browser.name": "Chrome", "browser.version": "131.0.6778.33", "os.type": "linux", "device.type": "desktop" },
    ],
    [
      "a Windows release with no known name",
      "Mozilla/4.0 (compatible; Windows NT 4.0)",
      { "os.type": "windows", "device.type": "desktop" },
    ],
    ["a user agent naming no browser or OS", "curl/8.4.0", {}],
  ])("reads %s from the user agent", (_, userAgent, expected) => {
    expect(detectRuntimeContext(browser({ userAgent }))).toStrictEqual({ "process.runtime.name": "browser", ...expected });
  });

  it("reads an iPad's Mac user agent as iOS on a tablet when the source reports touch points", () => {
    expect(detectRuntimeContext(browser({ userAgent: SAFARI_MAC, maxTouchPoints: 5 }))).toStrictEqual({
      "process.runtime.name": "browser",
      "browser.name": "Safari",
      "browser.version": "17.2",
      "os.type": "ios",
      "device.type": "tablet",
    });
  });

  it("reads a Mac user agent as macOS on a desktop when touch points are absent or at most one", () => {
    const expected = {
      "process.runtime.name": "browser",
      "browser.name": "Safari",
      "browser.version": "17.2",
      "os.type": "darwin",
      "os.version": "10.15.7",
      "device.type": "desktop",
    };
    expect(detectRuntimeContext(browser({ userAgent: SAFARI_MAC }))).toStrictEqual(expected);
    expect(detectRuntimeContext(browser({ userAgent: SAFARI_MAC, maxTouchPoints: 1 }))).toStrictEqual(expected);
    expect(detectRuntimeContext(browser({ userAgent: SAFARI_MAC, maxTouchPoints: "5" }))).toStrictEqual(expected);
  });

  it("reads the user agent in a web worker", () => {
    expect(detectRuntimeContext({ WorkerGlobalScope: {}, navigator: { userAgent: FIREFOX_LINUX } })).toStrictEqual({
      "process.runtime.name": "worker",
      "browser.name": "Firefox",
      "browser.version": "121.0",
      "os.type": "linux",
      "device.type": "desktop",
    });
  });

  it("never reads a bundler's process polyfill", () => {
    const source: RuntimeContextSource = {
      ...browser({ userAgent: CHROME_WINDOWS }),
      process: { version: "", platform: "browser" },
    };
    expect(detectRuntimeContext(source)).toStrictEqual({
      "process.runtime.name": "browser",
      "browser.name": "Chrome",
      "browser.version": "120.0.0.0",
      "os.type": "windows",
      "os.version": "10",
      "device.type": "desktop",
    });
  });

  it("returns a frozen object with undetected keys absent rather than undefined", () => {
    const context = detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX }));
    expect(Object.isFrozen(context)).toBe(true);
    expect("os.version" in context).toBe(false);
  });
});

describe("detectRuntimeContext with navigator.userAgentData", () => {
  it("takes the browser from a brand and keeps the user agent's fuller version when they agree", () => {
    const userAgentData = {
      brands: [
        { brand: "Not_A Brand", version: "8" },
        { brand: "Chromium", version: "120" },
        { brand: "Google Chrome", version: "120" },
      ],
      mobile: false,
      platform: "Windows",
    };
    expect(detectRuntimeContext(browser({ userAgent: CHROME_WINDOWS, userAgentData }))).toStrictEqual({
      "process.runtime.name": "browser",
      "browser.name": "Chrome",
      "browser.version": "120.0.0.0",
      "os.type": "windows",
      "os.version": "10",
      "device.type": "desktop",
    });
  });

  it("lets a brand outrank the user agent's browser, with the brand's major version", () => {
    const userAgentData = { brands: [{ brand: "Microsoft Edge", version: "120" }] };
    expect(detectRuntimeContext(browser({ userAgent: CHROME_WINDOWS, userAgentData }))).toMatchObject({
      "browser.name": "Edge",
      "browser.version": "120",
    });
  });

  it("ignores brands that name no browser, carry no version or are not a list", () => {
    const expected = { "process.runtime.name": "browser", "browser.name": "Chrome", "browser.version": "120.0.0.0" };
    for (const brands of [
      [{ brand: "Chromium", version: "120" }],
      [{ brand: "Opera" }],
      [{ brand: 7, version: "120" }],
      [null],
      "Google Chrome",
    ]) {
      const context = detectRuntimeContext(browser({ userAgent: "Chrome/120.0.0.0", userAgentData: { brands } }));
      expect(context).toStrictEqual(expected);
    }
  });

  it("lets the platform outrank the user agent's OS, dropping its version and rereading the device", () => {
    const desktopSite = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(detectRuntimeContext(browser({ userAgent: desktopSite, userAgentData: { platform: "Android", mobile: false } }))).toMatchObject({
      "os.type": "android",
      "device.type": "tablet",
    });
    const context = detectRuntimeContext(browser({ userAgent: CHROME_OS, userAgentData: { platform: "macOS" } }));
    expect(context).toMatchObject({ "os.type": "darwin", "device.type": "desktop" });
    expect("os.version" in context).toBe(false);
  });

  it("marks the device mobile when userAgentData says so, even behind a desktop user agent", () => {
    const desktopSite = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(detectRuntimeContext(browser({ userAgent: desktopSite, userAgentData: { platform: "Android", mobile: true } }))).toMatchObject({
      "os.type": "android",
      "device.type": "mobile",
    });
  });

  it("answers from userAgentData alone when there is no user agent", () => {
    const userAgentData = { brands: [{ brand: "Opera", version: "106" }], platform: "Chrome OS", mobile: false };
    expect(detectRuntimeContext(browser({ userAgentData }))).toStrictEqual({
      "process.runtime.name": "browser",
      "browser.name": "Opera",
      "browser.version": "106",
      "os.type": "chromeos",
      "device.type": "desktop",
    });
    expect(detectRuntimeContext(browser({ userAgentData: { platform: "iOS" } }))).toMatchObject({
      "os.type": "ios",
      "device.type": "tablet",
    });
  });

  it("ignores a platform it does not know and a null userAgentData", () => {
    const expected = detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX }));
    expect(detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX, userAgentData: { platform: "Haiku" } }))).toStrictEqual(expected);
    expect(detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX, userAgentData: { platform: 3 } }))).toStrictEqual(expected);
    const nullData = { userAgent: FIREFOX_LINUX, userAgentData: null } as unknown as NonNullable<RuntimeContextSource["navigator"]>;
    expect(detectRuntimeContext(browser(nullData))).toStrictEqual(expected);
  });
});

describe("detectRuntimeContext in a process-bearing runtime", () => {
  it("reads Node's version and platform, and nothing from its user agent", () => {
    const source: RuntimeContextSource = {
      process: { version: "v24.3.0", platform: "linux", versions: { node: "24.3.0" } },
      navigator: { userAgent: "Node.js/24" },
    };
    expect(detectRuntimeContext(source)).toStrictEqual({
      "process.runtime.name": "node",
      "process.runtime.version": "24.3.0",
      "os.type": "linux",
    });
  });

  it.each([
    ["darwin", "darwin"],
    ["win32", "windows"],
    ["freebsd", "freebsd"],
    ["openbsd", "openbsd"],
    ["netbsd", "netbsd"],
    ["aix", "aix"],
    ["sunos", "solaris"],
    ["android", "android"],
  ])("maps process.platform %s to os.type %s", (platform, osType) => {
    const source: RuntimeContextSource = { process: { version: "v24.3.0", platform, versions: { node: "24.3.0" } } };
    expect(detectRuntimeContext(source)["os.type"]).toBe(osType);
  });

  it("leaves out a version or platform that is missing, empty or not a string", () => {
    expect(detectRuntimeContext({ process: { version: "", platform: 7, versions: { node: "24.3.0" } } })).toStrictEqual({
      "process.runtime.name": "node",
    });
    expect(detectRuntimeContext({ process: { versions: { node: "24.3.0" } } })).toStrictEqual({ "process.runtime.name": "node" });
  });

  it("reads Bun's own version rather than the Node release it imitates", () => {
    const source: RuntimeContextSource = { Bun: { version: "1.2.0" }, process: { version: "v22.6.0", platform: "darwin" } };
    expect(detectRuntimeContext(source)).toStrictEqual({
      "process.runtime.name": "bun",
      "process.runtime.version": "1.2.0",
      "os.type": "darwin",
    });
  });

  it("reads Deno's own version rather than the Node release it imitates", () => {
    const source: RuntimeContextSource = { Deno: { version: { deno: "2.1.4" } }, process: { version: "v22.6.0", platform: "win32" } };
    expect(detectRuntimeContext(source)).toStrictEqual({
      "process.runtime.name": "deno",
      "process.runtime.version": "2.1.4",
      "os.type": "windows",
    });
  });

  it("leaves out Bun's and Deno's version when their global does not carry one", () => {
    expect(detectRuntimeContext({ Bun: null })).toStrictEqual({ "process.runtime.name": "bun" });
    expect(detectRuntimeContext({ Deno: {} })).toStrictEqual({ "process.runtime.name": "deno" });
  });

  it("reads an edge runtime's process when it has one", () => {
    expect(
      detectRuntimeContext({ navigator: { userAgent: "Cloudflare-Workers" }, process: { version: "v22.0.0", platform: "linux" } }),
    ).toStrictEqual({ "process.runtime.name": "edge", "process.runtime.version": "22.0.0", "os.type": "linux" });
    expect(detectRuntimeContext({ EdgeRuntime: "vercel" })).toStrictEqual({ "process.runtime.name": "edge" });
  });
});

describe("detectRuntimeContext in an unknown or hostile environment", () => {
  it("returns an empty frozen object for an empty source", () => {
    const context = detectRuntimeContext({});
    expect(context).toStrictEqual({});
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("still reads the user agent when the runtime cannot be identified", () => {
    expect(detectRuntimeContext({ navigator: { userAgent: FIREFOX_LINUX } })).toStrictEqual({
      "browser.name": "Firefox",
      "browser.version": "121.0",
      "os.type": "linux",
      "device.type": "desktop",
    });
  });

  it("returns what it can gather when a getter on the source throws", () => {
    const throwing = (): never => {
      throw new Error("denied");
    };
    const runtimeDenied = Object.defineProperty({ navigator: { userAgent: FIREFOX_LINUX } }, "Deno", { get: throwing });
    expect(detectRuntimeContext(runtimeDenied)).toStrictEqual({
      "browser.name": "Firefox",
      "browser.version": "121.0",
      "os.type": "linux",
      "device.type": "desktop",
    });

    const navigatorDenied = Object.defineProperty({ window: {}, document: {} }, "navigator", { get: throwing });
    expect(detectRuntimeContext(navigatorDenied)).toStrictEqual({});

    const userAgentData = Object.defineProperties(
      {},
      { brands: { get: throwing }, platform: { get: throwing }, mobile: { get: throwing } },
    );
    const brandDenied = { brands: [Object.defineProperty({}, "brand", { get: throwing })] };
    expect(detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX, userAgentData }))).toStrictEqual(
      detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX })),
    );
    expect(detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX, userAgentData: brandDenied }))).toStrictEqual(
      detectRuntimeContext(browser({ userAgent: FIREFOX_LINUX })),
    );

    const process = Object.defineProperties({ versions: { node: "24.3.0" } }, { version: { get: throwing }, platform: { get: throwing } });
    expect(detectRuntimeContext({ process })).toStrictEqual({ "process.runtime.name": "node" });
  });
});
