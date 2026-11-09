// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { installXhr, XHR_NETWORK_ERROR } from "./xhr";

// Browser-only: the page's real `XMLHttpRequest`, patched on its real prototype and loading a
// `data:` URL, so no server is involved. The suite in both runtimes covers the logic against a
// stand-in class.

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

function install(): void {
  uninstalls.push(installXhr({ clock: () => 0, redaction: secretKeys }));
}

/**
 * A fresh Unit of Work and a function that runs a callback inside it. The browser carries the
 * current scope on a synchronous stack, so a request is sent from inside `enter`, never after an
 * `await`.
 */
function unitOfWork() {
  return Scope.isolated("test", {}, () => ({
    scope: Scope.current(),
    enter: Scope.propagate((fn: () => void) => fn()),
  }));
}

/** Resolves once `xhr` has fired `loadend`, after every listener added before this call. */
function loadEnd(xhr: XMLHttpRequest): Promise<void> {
  return new Promise((resolve) => {
    xhr.addEventListener("loadend", () => resolve(), { once: true });
  });
}

describe("installXhr on the real XMLHttpRequest", () => {
  test("records a data: URL request with its redacted URL and status", async () => {
    install();
    const { scope, enter } = unitOfWork();
    const xhr = new XMLHttpRequest();

    enter(() => {
      xhr.open("get", "data:text/plain,hello?token=abc");
      xhr.send();
    });
    await loadEnd(xhr);

    expect(xhr.responseText).toBe("hello?token=abc");
    expect(breadcrumbs(scope)).toEqual([
      {
        time: 0,
        category: "http",
        level: "info",
        message: "GET data:text/plain,hello?token=[REDACTED]",
        data: { method: "GET", url: "data:text/plain,hello?token=[REDACTED]", status_code: 200, duration_ms: 0 },
      },
    ]);
  });

  test("an aborted request records a network error", async () => {
    install();
    const { scope, enter } = unitOfWork();
    const xhr = new XMLHttpRequest();

    enter(() => {
      xhr.open("GET", "data:text/plain,aborted");
      xhr.send();
    });
    const ended = loadEnd(xhr);
    xhr.abort();
    await ended;

    expect(breadcrumbs(scope).map((crumb) => [crumb.level, crumb.data?.error, crumb.data?.status_code])).toEqual([
      ["error", XHR_NETWORK_ERROR, undefined],
    ]);
  });

  test("a request sent while suppressed records nothing", async () => {
    install();
    const { scope, enter } = unitOfWork();
    const xhr = new XMLHttpRequest();

    enter(() => {
      xhr.open("GET", "data:text/plain,internal");
      suppressBreadcrumbs(() => xhr.send());
    });
    await loadEnd(xhr);

    expect(breadcrumbs(scope)).toEqual([]);
  });

  test("an instance re-used for a second request records each once", async () => {
    install();
    const { scope, enter } = unitOfWork();
    const xhr = new XMLHttpRequest();

    enter(() => {
      xhr.open("GET", "data:text/plain,first");
      xhr.send();
    });
    await loadEnd(xhr);
    enter(() => {
      xhr.open("POST", "data:text/plain,second");
      xhr.send();
    });
    await loadEnd(xhr);

    expect(breadcrumbs(scope).map((crumb) => crumb.message)).toEqual(["GET data:text/plain,first", "POST data:text/plain,second"]);
  });

  test("restores the real prototype methods when the last install leaves", () => {
    const { open, send } = XMLHttpRequest.prototype;
    const uninstall = installXhr({ clock: () => 0, redaction: secretKeys });

    expect(XMLHttpRequest.prototype.open).not.toBe(open);
    expect(XMLHttpRequest.prototype.send).not.toBe(send);
    uninstall();

    expect(XMLHttpRequest.prototype.open).toBe(open);
    expect(XMLHttpRequest.prototype.send).toBe(send);
  });
});
