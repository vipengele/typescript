const fs = require("node:fs");

export const exists = (path: string): boolean => fs.existsSync(path);
