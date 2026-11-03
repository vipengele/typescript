import type { DeliveryLimits } from "./delivery";

const INTEGER_LIMITS = ["maxQueueSize", "maxBatchSize", "maxAttempts"] as const;
const DURATION_LIMITS = ["scheduleDelayMs", "attemptTimeoutMs", "flushTimeoutMs"] as const;

/**
 * Why `url` cannot be a delivery's endpoint, or `undefined` when it is an absolute `http:` or
 * `https:` URL.
 */
function urlProblem(url: unknown): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url as string);
  } catch {
    return `url to be an absolute http or https URL, got ${String(url)}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `url to use http or https, got ${parsed.protocol}`;
  }
  return undefined;
}

/**
 * Why `limits` cannot configure a delivery, naming the first invalid limit, or `undefined` when
 * every limit given is valid: the sizes and `maxAttempts` integers of at least 1, the delays and
 * timeouts positive and finite.
 */
function limitsProblem(limits: Partial<DeliveryLimits>): string | undefined {
  const integer = INTEGER_LIMITS.find((name) => !isValidInteger(limits[name]));
  if (integer !== undefined) {
    return `${integer} to be an integer of at least 1, got ${limits[integer]}`;
  }
  const duration = DURATION_LIMITS.find((name) => !isValidDuration(limits[name]));
  if (duration !== undefined) {
    return `${duration} to be positive and finite, got ${limits[duration]}`;
  }
  return undefined;
}

/**
 * Why a delivery cannot be created from `url` and `limits`, or `undefined` when both are valid. The
 * url is checked first. The text completes a message that begins "<caller> expects ", such as
 * `"url to use http or https, got ftp:"`, so each caller names itself in its own error.
 */
export function deliveryOptionsProblem(url: unknown, limits: Partial<DeliveryLimits> = {}): string | undefined {
  return urlProblem(url) ?? limitsProblem(limits);
}

function isValidInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1);
}

function isValidDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0);
}
