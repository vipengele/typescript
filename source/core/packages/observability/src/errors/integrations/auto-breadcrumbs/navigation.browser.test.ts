// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { installNavigation } from "./navigation";
import { redactBreadcrumbUrl } from "./url";

// Browser-only: the page's real `history`, `location` and `popstate`. Every test changes only the
// fragment, so the page never reloads and the test runner's own query parameters stay in place, and
// puts the starting URL back afterwards. The suite in both runtimes covers the logic against a
// stand-in window.

let start = "";
const uninstalls: (() => void)[] = [];

beforeEach(() => {
  start = location.href;
});

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
  history.replaceState(history.state, "", start);
});

function install(): void {
  uninstalls.push(installNavigation({ clock: () => 0, redaction: secretKeys }));
}

/** Runs `fn` in a fresh Unit of Work, synchronously, and returns the trail it left. */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

/** `start` with its fragment replaced by `hash`, as a navigation breadcrumb records it. */
function at(hash: string): string {
  const url = new URL(start);
  url.hash = hash;
  return redactBreadcrumbUrl(url.href, secretKeys);
}

describe("installNavigation on the real history", () => {
  test("records replaceState with the resolved, redacted URL", () => {
    history.replaceState(history.state, "", "#nav-start");
    install();

    const trail = trailOf(() => history.replaceState(history.state, "", "#nav=1&token=abc"));

    expect(location.hash).toBe("#nav=1&token=abc");
    expect(at("nav=1&token=abc")).toMatch(/#nav=1&token=\[REDACTED\]$/);
    expect(trail).toEqual([
      {
        time: 0,
        category: "navigation",
        level: "info",
        message: `${at("nav-start")} → ${at("nav=1&token=abc")}`,
        data: { from: at("nav-start"), to: at("nav=1&token=abc") },
      },
    ]);
  });

  test("records pushState, then a real popstate from the last-known URL", async () => {
    history.replaceState(history.state, "", "#nav-start");
    install();

    const pushed = trailOf(() => history.pushState(null, "", "#nav-pushed"));
    const popped = new Promise<void>((resolve) => {
      addEventListener("popstate", () => resolve(), { once: true });
    });
    history.back();
    await popped;

    expect(pushed.map((crumb) => crumb.data)).toEqual([{ from: at("nav-start"), to: at("nav-pushed") }]);
    expect(location.hash).toBe("#nav-start");
    // `popstate` fires in its own task, outside any Unit of Work, so it records into the root's trail.
    expect(breadcrumbs(Scope.current()).at(-1)?.data).toEqual({ from: at("nav-pushed"), to: at("nav-start") });
  });

  test("restores the real history methods when the last install leaves", () => {
    const { pushState, replaceState } = history;
    const uninstall = installNavigation({ clock: () => 0, redaction: secretKeys });

    expect(history.pushState).not.toBe(pushState);
    uninstall();

    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
    expect(trailOf(() => history.replaceState(history.state, "", "#after"))).toEqual([]);
  });
});
