/**
 * The base of every error the vipengele TypeScript framework raises. A stable `code` lets a
 * caller branch on the failure kind without parsing `message`, which is free to change.
 */
export abstract class VipengeleError extends Error {
  abstract readonly code: string;
}
