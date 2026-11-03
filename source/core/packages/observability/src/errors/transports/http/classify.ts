/**
 * How an HTTP response status settles a delivery: `"delivered"` is accepted, `"retry"` is worth
 * sending again, `"rejected"` will not succeed on a resend.
 */
export type StatusClass = "delivered" | "retry" | "rejected";

/**
 * Classifies an HTTP status: 2xx is delivered; 408, 429 and 5xx are retried; every other status,
 * redirects included, is rejected.
 */
export function classify(status: number): StatusClass {
  if (status >= 200 && status < 300) {
    return "delivered";
  }
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    return "retry";
  }
  return "rejected";
}
