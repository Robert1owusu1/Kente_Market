#!/usr/bin/env node
// .github/scripts/audit-gate.mjs — dependency-advisory ratchet (N-11).
//
// Why this exists instead of `npm audit --audit-level=high`:
//
//   A raw gate cannot pass in this repository today. `braces` (pulled in by
//   tailwindcss 3.x in the frontend and by nodemon in the backend) is
//   advisory-affected in EVERY published version — npm reports the fix as
//   "run npm audit fix --force", i.e. migrate to tailwindcss v4, a breaking
//   build-toolchain change that is deliberately out of scope for this pass.
//   A gate that is red on day one does not stay a gate; it gets ignored and
//   then deleted.
//
// So the gate is a ratchet instead. The advisories we have accepted are listed
// in a baseline JSON next to the workflow, each with the reason it is
// accepted, and CI fails when:
//
//   * a NEW high/critical advisory appears that is not in the baseline,
//   * an accepted advisory gets WORSE (baseline says high, npm now says
//     critical) — accepting "high" must not silently accept "critical",
//   * npm audit itself errored (missing JSON, network failure). An audit that
//     did not run must never be reported as an audit that passed.
//
// Moderate and below are printed for visibility but never fail the build.
// Baseline entries that no longer appear are only a NOTE: fixing an advisory
// must not turn the build red. The note is printed so the baseline gets
// tightened afterwards (entries can only shrink, never grow).
//
// Usage: node .github/scripts/audit-gate.mjs <npm-audit.json> <baseline.json>

import { readFileSync } from 'node:fs';

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const FAIL_RANK = SEVERITY_RANK.high;

const fail = (msg) => {
  // ::error:: makes the message surface as an annotation on the workflow run.
  console.error(`::error::${msg}`);
  process.exit(1);
};

const [auditPath, baselinePath] = process.argv.slice(2);
if (!auditPath || !baselinePath) {
  fail('usage: audit-gate.mjs <npm-audit.json> <baseline.json>');
}

let audit;
try {
  audit = JSON.parse(readFileSync(auditPath, 'utf8'));
} catch (err) {
  fail(`could not read npm audit output (${auditPath}): ${err.message}`);
}
if (audit.error) {
  fail(`npm audit did not complete: ${audit.error.summary || audit.error.code || 'unknown error'}`);
}
if (!audit.vulnerabilities || !audit.metadata) {
  fail(`unexpected npm audit shape in ${auditPath}`);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (err) {
  fail(`could not read baseline (${baselinePath}): ${err.message}`);
}
const accepted = baseline.accepted || {};
const reasons = baseline.reasons || {};

// Only high/critical can fail the gate; everything else is informational.
const current = {};
for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
  if ((SEVERITY_RANK[vuln.severity] ?? 0) >= FAIL_RANK) {
    current[name] = vuln.severity;
  }
}

const problems = [];
const stale = [];

for (const [name, acceptedSeverity] of Object.entries(accepted)) {
  if (!(name in current)) {
    stale.push(name);
    continue;
  }
  const now = SEVERITY_RANK[current[name]] ?? 0;
  const then = SEVERITY_RANK[acceptedSeverity] ?? 0;
  if (now > then) {
    problems.push(
      `${name}: severity rose ${acceptedSeverity} -> ${current[name]} (the baseline only accepted ${acceptedSeverity})`
    );
  }
}

for (const [name, severity] of Object.entries(current)) {
  if (!(name in accepted)) {
    problems.push(`${name}: new ${severity} advisory, not present in ${baselinePath}`);
  }
}

const counts = audit.metadata.vulnerabilities;
console.log(
  `advisories: critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} low=${counts.low}`
);
console.log(
  `high/critical now: ${Object.keys(current).length} | accepted in baseline: ${Object.keys(accepted).length}`
);
for (const [name, severity] of Object.entries(current)) {
  const why = reasons[name] ? ` — ${reasons[name]}` : '';
  console.log(`  accepted ${name} (${severity})${why}`);
}

if (stale.length > 0) {
  console.log(
    `::notice::baseline entries no longer reported (please tighten ${baselinePath}): ${stale.join(', ')}`
  );
}

if (problems.length > 0) {
  console.error('::error::dependency audit gate failed:');
  for (const p of problems) console.error(`::error::  ${p}`);
  process.exit(1);
}

console.log('dependency audit gate passed (no new high/critical advisories)');
