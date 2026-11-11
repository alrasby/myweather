#!/usr/bin/env node
/** CI-only read-back of npm's own lockfile solver, without repository write
 * permissions. The patch lines are consumed and reviewed before any GitHub
 * contents update. This script MUST NOT be part of release build tasks. */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const before = read("package-lock.json");
const oldManifest = read("package.json");

const run = (args, requireSuccess = true) => {
  const cp = spawnSync("npm", args, {
    encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 200000,
  });
  console.log("SECURITY_PROBE_COMMAND", args.join(" "), "exit", cp.status,
    "stderr", (cp.stderr ?? "").slice(-450));
  if (requireSuccess && cp.status !== 0) {
    throw new Error("npm resolver failed: " + args.join(" ") + " " + (cp.stdout ?? "").slice(-800));
  }
  return cp;
};

// The only remaining seven advisories after ordinary npm audit fix are
// development-only, all cascading from typescript-estree's minimatch 10.x.
// Force only this nested parser dependency onto the patched minimatch 11.x;
// never override unrelated minimatch v3 consumers.
const withOverride = read("package.json");
withOverride.overrides ??= {};
withOverride.overrides["@typescript-eslint/typescript-estree"] = {
  minimatch: "^11.0.1",
};
writeFileSync("package.json", JSON.stringify(withOverride, null, 2) + "\\n");

run(["pkg", "set", "dependencies.better-auth=^1.7.21", "dependencies.zod=^4.6.6"]);
run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
run(["audit", "fix", "--package-lock-only", "--ignore-scripts", "--no-fund"], false);

const after = read("package-lock.json");
const newManifest = read("package.json");
if (after.lockfileVersion !== 3) throw new Error("Unexpected npm lockfile format");
if (newManifest.dependencies["better-auth"] !== "^1.7.21" || newManifest.dependencies.zod !== "^4.6.6" || newManifest.overrides?.["@typescript-eslint/typescript-estree"]?.minimatch !== "^11.0.1") {
  throw new Error("Core patched version constraints were not applied");
}
console.log("SECURITY_PATCH_MANIFEST " + JSON.stringify(newManifest));
console.log("SECURITY_PATCH_LOCK_ROOT " + JSON.stringify({
  name: after.name, version: after.version, lockfileVersion: after.lockfileVersion,
  requires: after.requires, packagesRoot: after.packages[""],
}));
let changed = 0, removed = 0;
for (const [key, value] of Object.entries(after.packages)) {
  if (key === "") continue;
  if (JSON.stringify(before.packages[key]) !== JSON.stringify(value)) {
    console.log("SECURITY_PATCH_LOCK_NODE " + JSON.stringify({ key, value }));
    changed += 1;
  }
}
for (const key of Object.keys(before.packages)) {
  if (key && !Object.hasOwn(after.packages, key)) {
    console.log("SECURITY_PATCH_LOCK_DELETE " + JSON.stringify({ key }));
    removed += 1;
  }
}
console.log("SECURITY_PATCH_SUMMARY " + JSON.stringify({ changed, removed,
  oldNodes: Object.keys(before.packages).length, newNodes: Object.keys(after.packages).length }));
for (const [scope, extra] of [["all", []], ["production", ["--omit=dev"]]]) {
  const cp = run(["audit", "--json", ...extra], false);
  const report = JSON.parse(cp.stdout);
  console.log("SECURITY_AFTER_AUDIT " + JSON.stringify({
    scope, issues: report.metadata?.vulnerabilities, vulnerable: Object.keys(report.vulnerabilities ?? {}),
  }));
}
