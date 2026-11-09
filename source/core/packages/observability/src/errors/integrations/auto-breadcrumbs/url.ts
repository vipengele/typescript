import { type RedactionPolicy, redactUrl, secretKeys } from "@vipengele/ts-core-redaction";

/**
 * Stands in for a URL that could not be redacted. A breadcrumb never holds a raw URL (ADR-0028 item
 * 6), so a URL the policy fails on is replaced whole rather than recorded as written.
 */
export const UNREDACTABLE_URL = "[REDACTED: unredactable url]";

/**
 * `url` with its userinfo and every query and fragment parameter `policy` matches redacted, as
 * `redactUrl` redacts them; `policy` defaults to `secretKeys`, as does a value that is not an
 * object, which an install from another copy of the package may hand over. It never throws: a
 * policy that fails while the URL is redacted gives {@link UNREDACTABLE_URL}.
 */
export function redactBreadcrumbUrl(url: string, policy: RedactionPolicy = secretKeys): string {
  try {
    return redactUrl(url, { policy: typeof policy === "object" && policy !== null ? policy : secretKeys });
  } catch {
    return UNREDACTABLE_URL;
  }
}
