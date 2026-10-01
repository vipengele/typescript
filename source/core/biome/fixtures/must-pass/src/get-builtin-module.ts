export const loadFs = () => {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    return undefined;
  }
  return process.getBuiltinModule("node:fs");
};
