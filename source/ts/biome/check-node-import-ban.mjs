// Proves the `node:` import ban in ./no-node-imports.grit does what it claims, against the
// project's real biome.json: every must-fail fixture yields exactly one diagnostic from the plugin,
// every must-pass fixture yields none, and every project's copy of the rule is byte-identical to
// this one. Biome resolves a plugin path relative to the biome.json naming it, so each project
// carries its own copy and nothing else keeps them from drifting apart.
//
// The fixtures sit behind fixtures/.ignore so the project-wide `biome lint .` never reports them;
// this script lints them with `--vcs-use-ignore-file=false` to lift that one exclusion and nothing
// else. The fixture paths keep a `src/` segment so the plugin's `includes` select them exactly as
// they select shipped code.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RULE_FILE = "no-node-imports.grit";
const MESSAGE_PREFIX = "Only `import type` may name a `node:` specifier";

const biomeDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(biomeDir);
const sourceDir = dirname(projectDir);
const biomeBin = createRequire(join(projectDir, "package.json")).resolve("@biomejs/biome/bin/biome");

const failures = [];

function fixtures(kind) {
  const dir = join(biomeDir, "fixtures", kind, "src");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => relative(projectDir, join(dir, name)));
}

function lint(path) {
  const result = spawnSync(
    process.execPath,
    [biomeBin, "lint", "--only=plugin", "--reporter=json", "--vcs-use-ignore-file=false", "--max-diagnostics=none", path],
    { cwd: projectDir, encoding: "utf8" },
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    failures.push(`${path}: biome produced no JSON report (exit ${result.status})\n${result.stderr}`);
    return undefined;
  }
  if (report.summary.unchanged + report.summary.changed !== 1) {
    failures.push(`${path}: biome did not lint the fixture; it was skipped or ignored`);
    return undefined;
  }
  return { status: result.status, diagnostics: report.diagnostics };
}

for (const path of fixtures("must-fail")) {
  const outcome = lint(path);
  if (outcome === undefined) {
    continue;
  }
  const banned = outcome.diagnostics.filter((d) => d.category === "plugin" && d.message.startsWith(MESSAGE_PREFIX));
  if (outcome.status === 0 || banned.length !== 1 || outcome.diagnostics.length !== 1) {
    failures.push(
      `${path}: expected exactly one \`node:\` ban diagnostic and a failing exit, got exit ${outcome.status} with ` +
        `${JSON.stringify(outcome.diagnostics.map((d) => `${d.category}: ${d.message}`))}`,
    );
  }
}

for (const path of fixtures("must-pass")) {
  const outcome = lint(path);
  if (outcome === undefined) {
    continue;
  }
  if (outcome.status !== 0 || outcome.diagnostics.length !== 0) {
    failures.push(
      `${path}: expected no diagnostics, got exit ${outcome.status} with ` +
        `${JSON.stringify(outcome.diagnostics.map((d) => `${d.category}: ${d.message}`))}`,
    );
  }
}

const ownRule = readFileSync(join(biomeDir, RULE_FILE));
const siblingRules = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(sourceDir, entry.name, "biome", RULE_FILE))
  .filter((path) => path !== join(biomeDir, RULE_FILE) && existsSync(path));
if (siblingRules.length === 0) {
  failures.push(`no other project under ${sourceDir} carries biome/${RULE_FILE} to compare against`);
}
for (const path of siblingRules) {
  if (!readFileSync(path).equals(ownRule)) {
    failures.push(
      `${relative(sourceDir, path)} differs from ${relative(sourceDir, join(biomeDir, RULE_FILE))}; every copy must be byte-identical`,
    );
  }
}

if (failures.length > 0) {
  console.error(`node: import ban check failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `node: import ban check passed: ${fixtures("must-fail").length} must-fail and ${fixtures("must-pass").length} must-pass fixtures, ` +
    `${siblingRules.length + 1} identical rule copies`,
);
