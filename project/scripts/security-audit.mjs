#!/usr/bin/env node
/**
 * Diagnose locked npm dependency advisories with actionable package/version
 * details; do not mutate package.json or package-lock.json during reporting.
 * Fails closed on registry errors and ANY advisory (including build tools).
 * A green PR cannot silently ship known vulnerable dependencies.
 */
import { spawnSync } from "node:child_process";

for (const [scope, flags] of [["all", []], ["production", ["--omit=dev"]]]) {
  const child = spawnSync("npm", ["audit", "--json", ...flags], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 24 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  let report;
  try {
    report = JSON.parse(child.stdout);
  } catch {
    console.error(`SECURITY_AUDIT_${scope.toUpperCase()}_ERROR: ${child.stderr.slice(0, 500)}`);
    process.exitCode = 2;
    continue;
  }
  if (report.error || !report.vulnerabilities) {
    console.error(`SECURITY_AUDIT_${scope.toUpperCase()}_ERROR ${JSON.stringify(report.error ?? {})}`);
    process.exitCode = 2;
    continue;
  }
  console.log(`SECURITY_AUDIT_SCOPE ${scope} ${JSON.stringify(report.metadata?.vulnerabilities ?? {})}`);
  for (const [name, v] of Object.entries(report.vulnerabilities)) {
    const via = (v.via ?? []).map((x) =>
      typeof x === "string" ? x : `${x.name}@${x.range}${x.url ? " " + x.url : ""}`
    );
    console.log("SECURITY_ADVISORY " + JSON.stringify({
      scope, name, severity: v.severity, direct: v.isDirect,
      range: v.range, fixAvailable: v.fixAvailable, via, effects: v.effects,
      nodes: v.nodes,
    }));
  }
  const total = Number(report.metadata?.vulnerabilities?.total ?? Object.keys(report.vulnerabilities).length);
  if (total > 0) {
    console.error(`SECURITY_AUDIT_BLOCKED ${scope}: ${total} known advisories remain`);
    process.exitCode = 1;
  }
}
