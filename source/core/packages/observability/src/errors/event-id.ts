/** Random bytes in an Error Event id; two hex characters each. */
const ID_BYTES = 16;

/**
 * A fresh Error Event id: 32 lower-case hex characters from `crypto.getRandomValues`, a global in
 * every supported runtime, generated at capture so a dedup key and a report ID shown to a user refer
 * to the same event before it is sent (ADR-0007).
 */
export function createEventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  let id = "";
  for (const byte of bytes) {
    id += byte.toString(16).padStart(2, "0");
  }
  return id;
}
