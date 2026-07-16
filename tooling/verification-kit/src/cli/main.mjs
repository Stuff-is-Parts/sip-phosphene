import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, hostTree, abs } from '../core/paths.mjs';
import { loadStore } from '../core/store.mjs';
import { hashFile, canonicalJsonHash, sha256Hex } from '../core/hash.mjs';
import { writeReport } from '../core/report.mjs';
import { initialize } from '../core/init.mjs';
import { lockSurfaces, verifyLock, updateLock } from '../core/locks.mjs';
import {
  computeClaimResult, computeRequirementResult, computeGlobalResult,
  surfaceLockFailures, oracleCheck, bindingFor, inventoryCheck, authoritiesCheck, evidenceCheck
} from '../core/engine.mjs';
import { computeFrameworkResult } from '../core/framework.mjs';
import { changeIntegrity } from '../core/integrity.mjs';
import { runInClean } from '../core/clean.mjs';
import { witnessStatus } from '../core/authorization.mjs';
import { verifyWitnessLive } from '../core/livehost.mjs';
import { verifyAttestationLineage } from '../core/lineage.mjs';
import { bootstrapConformanceStatus } from '../core/conformance.mjs';
import { invokeCapability } from '../core/adapters.mjs';
import { spawnSync } from 'node:child_process';

const kitDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const selfTestBindingPath = path.join(kitDir, 'src', 'self-test', 'self-test-binding.json');

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const [command, ...rest] = argv;
  const repoRoot = findRepoRoot(process.cwd());

  if (!command) return globalVerify(repoRoot);
  switch (command) {
    case 'init': return cmdInit(repoRoot);
    case 'framework': return cmdFramework(repoRoot);
    case 'scope': return cmdScope(repoRoot);
    case 'authorization': return cmdAuthorization(repoRoot);
    case 'authorization-attestations': return cmdAttestations(repoRoot);
    case 'profiles': return cmdProfiles(repoRoot);
    case 'project-binding': return cmdBinding(repoRoot);
    case 'authorities': return cmdAuthorities(repoRoot);
    case 'conflicts': return cmdConflicts(repoRoot);
    case 'evidence': return cmdEvidence(repoRoot);
    case 'oracles': return cmdOracles(repoRoot);
    case 'inventory-coverage': return cmdInventoryCoverage(repoRoot);
    case 'requirements': return cmdRequirements(repoRoot);
    case 'claims': return cmdClaims(repoRoot);
    case 'providers': return cmdProviders(repoRoot);
    case 'requirement': return cmdOneRequirement(repoRoot, rest[0]);
    case 'claim': return cmdOneClaim(repoRoot, rest[0]);
    case 'change-integrity': return cmdChangeIntegrity(repoRoot, rest);
    case 'clean':
    case 'clean-integrity': return cmdCleanTarget(repoRoot, 'clean-integrity', ['framework'], 'framework integrity surfaces only; makes no completion claim');
    case 'clean-completion': return cmdCleanTarget(repoRoot, 'clean-completion', [], 'the global completion gate executed in a clean checkout; its actual result propagates');
    case 'clean-claim': return rest[0] ? cmdCleanTarget(repoRoot, 'clean-claim', ['claim', rest[0]], `claim ${rest[0]} executed in a clean checkout; its actual result propagates`) : usage('verify clean-claim <claim-id>');
    case 'clean-requirement': return rest[0] ? cmdCleanTarget(repoRoot, 'clean-requirement', ['requirement', rest[0]], `requirement ${rest[0]} executed in a clean checkout; its actual result propagates`) : usage('verify clean-requirement <requirement-id>');
    case 'authorization-live': return cmdAuthorizationLive(repoRoot, rest);
    case 'authorization-lineage': return cmdAuthorizationLineage(repoRoot);
    case 'framework-bootstrap-conformance': return cmdBootstrapConformance(repoRoot);
    case 'framework-conformance-suite': return cmdConformanceSuite(repoRoot);
    case 'semantic-acceptance': return cmdSemanticAcceptance(repoRoot);
    case 'evidence-bundle': return cmdEvidenceBundle(repoRoot);
    case 'capture-oracle': return cmdCaptureOracle(repoRoot, rest);
    case 'framework-conformance-lock': return cmdLock(repoRoot, 'framework-conformance', rest);
    case 'scope-lock': return cmdLock(repoRoot, 'scope', rest);
    case 'authorization-lock': return cmdLock(repoRoot, 'authorization', rest);
    case 'project-binding-lock': return cmdLock(repoRoot, 'binding', rest);
    case 'evidence-lock': return cmdLock(repoRoot, 'evidence', rest);
    case 'fixtures-lock': return cmdLock(repoRoot, 'fixtures', rest);
    case 'comparators-lock': return cmdLock(repoRoot, 'comparators', rest);
    case 'authorities-lock': return cmdLock(repoRoot, 'authorities', rest);
    case 'profiles-lock': return cmdLock(repoRoot, 'profiles', rest);
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      return 2;
  }
}

/** @param {string} repoRoot @returns {ReturnType<typeof loadStore>} */
function load(repoRoot) {
  return loadStore(repoRoot, { selfTestBindingPath });
}

/**
 * @param {string} repoRoot @param {string} command
 * @param {{ result: 'PASS' | 'FAIL', failures?: Array<{code: string, detail: string}> }} payload
 * @param {Record<string, unknown>} [extra]
 * @returns {number}
 */
function finish(repoRoot, command, payload, extra = {}) {
  const tree = hostTree(repoRoot);
  const reportPath = writeReport({ repoRoot, tree }, command, { ...payload, ...extra });
  const failures = payload.failures ?? [];
  process.stdout.write(`${command}: ${payload.result}\n`);
  for (const f of failures.slice(0, 50)) process.stdout.write(`  ${f.code}: ${f.detail}\n`);
  if (failures.length > 50) process.stdout.write(`  … ${failures.length - 50} more failures (see report)\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  return payload.result === 'PASS' ? 0 : 1;
}

/** @param {string} repoRoot @returns {number} */
function cmdInit(repoRoot) {
  const r = initialize(repoRoot);
  const tree = hostTree(repoRoot);
  const reportPath = writeReport({ repoRoot, tree }, 'init', /** @type {any} */ (r));
  process.stdout.write(`init: created ${r.created.length}, preserved ${r.preserved.length}, refused ${r.refused.length}\n`);
  for (const ref of r.refused) process.stdout.write(`  refused ${ref.path}: ${ref.reason}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  return 0;
}

/** @param {string} usageText @returns {number} */
function usage(usageText) {
  process.stderr.write(`usage: ${usageText}\n`);
  return 2;
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function globalVerify(repoRoot) {
  const store = load(repoRoot);
  const frameworkResult = await computeFrameworkResult(store, kitDir);
  const g = await computeGlobalResult(store, { frameworkResult });
  return finish(repoRoot, 'verify', { result: g.result, failures: g.failures }, {
    note: 'sole global completion gate: PASS requires every host requirement, every scope-item decomposition, AND the complete framework verification result; clean reproduction is gated by verify clean-completion',
    frameworkComponent: g.frameworkComponent,
    requirements: g.requirements,
    coverageMatrix: frameworkResult.matrix
  });
}

/**
 * @param {string} repoRoot @param {string} command @param {string[]} targetArgs @param {string} surfaceStatement
 * @returns {number}
 */
function cmdCleanTarget(repoRoot, command, targetArgs, surfaceStatement) {
  const r = runInClean(repoRoot, targetArgs);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  for (const s of r.steps.filter((x) => x.exitCode !== 0 && !x.step.startsWith('target:'))) {
    failures.push({ code: 'CHECK_FAILED', detail: `clean setup step '${s.step}' exited ${s.exitCode}` });
  }
  if (r.targetExitCode === null) {
    failures.push({ code: 'CHECK_FAILED', detail: 'target command did not run in the clean checkout' });
  } else if (r.targetExitCode !== 0) {
    failures.push({ code: 'CHECK_FAILED', detail: `target '${targetArgs.join(' ') || 'verify (global)'}' exited ${r.targetExitCode} in the clean checkout — this result propagates (audit finding 6)` });
  }
  return finish(repoRoot, command, { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    surface: surfaceStatement,
    cleanCheckoutSourceCommit: r.sourceCommit,
    steps: r.steps.map((s) => ({ step: s.step, exitCode: s.exitCode }))
  });
}

/** @param {string} repoRoot @returns {number} */
function cmdAuthorizationLineage(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const outcomes = [];
  for (const attestation of store.attestations) {
    const r = verifyAttestationLineage(store, attestation);
    outcomes.push({ attestationId: attestation.attestationId, ok: r.ok, reasons: r.reasons });
    if (!r.ok) {
      for (const reason of r.reasons) failures.push({ code: 'AUTHORIZATION_LINEAGE_INVALID', detail: `attestation '${attestation.attestationId}': ${reason}` });
    }
  }
  for (const w of store.witnesses) {
    if (!w.reviewedRevision) {
      failures.push({ code: 'AUTHORIZATION_LINEAGE_INVALID', detail: `witness '${w.witnessId}' lacks an exact reviewed revision (mandatory per §7.10)` });
    }
  }
  for (const e of store.structuralErrors.filter((s) => s.includes('witnesses') || s.includes('attestations'))) {
    failures.push({ code: 'AUTHORIZATION_LINEAGE_INVALID', detail: `[structural] ${e}` });
  }
  return finish(repoRoot, 'authorization-lineage', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    note: 'lineage verification of retained attestations: reviewed-revision ancestry plus unchanged protected artifacts (§7.10). This is not live authentication and never re-authenticates the external actor.',
    outcomes
  });
}

/** @param {string} repoRoot @returns {number} */
function cmdBootstrapConformance(repoRoot) {
  const store = load(repoRoot);
  const r = bootstrapConformanceStatus(store);
  return finish(repoRoot, 'framework-bootstrap-conformance', { result: r.failures.length === 0 ? 'PASS' : 'FAIL', failures: r.failures }, {
    status: r.status,
    note: 'the independent bootstrap-conformance judgment must come from an authenticated authority outside the correlated producer (§7.10A); the producing agent cannot issue it'
  });
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdConformanceSuite(repoRoot) {
  const store = load(repoRoot);
  const fw = await computeFrameworkResult(store, kitDir);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = fw.failures.filter((f) => f.detail.startsWith('[conformance-suite]'));
  return finish(repoRoot, 'framework-conformance-suite', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    scenarioResults: fw.conformanceSuite.scenarioResults,
    contractCoverage: fw.conformanceSuite.contractCoverage,
    note: 'runs the governed canonical controls through public boundaries and verifies suite governance (§7.10B)'
  });
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdSemanticAcceptance(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const audits = [];
  for (const requirement of store.requirements) {
    const r = await computeRequirementResult(store, requirement);
    audits.push({ requirementId: r.requirementId, bindingFieldAudit: r.bindingFieldAudit });
    for (const f of r.failures.filter((x) => x.code === 'SEMANTIC_PROXY_SUBSTITUTION' || x.detail.includes('[binding:'))) {
      failures.push(f);
    }
  }
  const suite = store.conformanceSuite;
  for (const bc of (store.binding?.requirementClasses ?? [])) {
    for (const contract of bc.semanticAcceptanceContracts ?? []) {
      const refs = [
        ...(contract.controlScenarioRefs?.positive ?? []),
        ...(contract.controlScenarioRefs?.structuralNegative ?? []),
        ...(contract.controlScenarioRefs?.semanticNegative ?? [])
      ];
      for (const ref of refs) {
        const found = (suite?.controlScenarios ?? []).some((/** @type {any} */ s) => s.scenarioId === ref);
        if (!found) {
          failures.push({ code: 'SEMANTIC_PROXY_SUBSTITUTION', detail: `binding contract '${contract.propertyId}' references canonical scenario '${ref}' which the governed suite does not define` });
        }
      }
    }
  }
  return finish(repoRoot, 'semantic-acceptance', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    audits,
    note: 'rejects mandatory fields or policies implemented only through correlated proxies (§14.5); full three-condition demonstration is judged by verify framework via the canonical suite'
  });
}

/** @param {string} repoRoot @param {string[]} rest @returns {number} */
function cmdAuthorizationLive(repoRoot, rest) {
  const store = load(repoRoot);
  const witnessFilter = argValue(rest, '--witness');
  const candidates = store.witnesses.filter((w) =>
    w.verificationMethod === 'github-approval' && (!witnessFilter || w.witnessId === witnessFilter));
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const outcomes = [];
  if (candidates.length === 0) {
    failures.push({ code: 'AUTHORIZATION_WITNESS_MISSING', detail: witnessFilter ? `witness '${witnessFilter}' not found or not github-approval` : 'no github-approval witnesses retained to verify live' });
  }
  for (const witness of candidates) {
    const r = verifyWitnessLive(store, witness);
    outcomes.push({ witnessId: witness.witnessId, ok: r.ok, reasons: r.reasons, attestationPath: r.attestationPath });
    if (!r.ok) {
      const code = witness.authorizationType === 'allowlist-change' ? 'IDENTITY_ALLOWLIST_CHANGE_UNAUTHORIZED' : 'AUTHORIZATION_WITNESS_UNVERIFIED';
      failures.push({ code, detail: `witness '${witness.witnessId}': ${r.reasons.join('; ')}` });
    }
  }
  return finish(repoRoot, 'authorization-live', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    note: 'LIVE host authentication through gh api — distinct from authorization-attestations, which verifies only retained attestation integrity. New attestations require an authorization-lock update with a reason.',
    outcomes
  });
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdEvidenceBundle(repoRoot) {
  const { execFileSync } = await import('node:child_process');
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const treeHash = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleRel = `verification/evidence-bundle/${stamp}-${commit.slice(0, 8)}`;
  const bundleAbs = abs(repoRoot, bundleRel);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(bundleAbs, { recursive: true });

  /** @type {Array<{args: string[], ids: string[]}>} */
  const material = [
    { args: ['framework'], ids: ['REQ-SELFTEST-CRC32', 'CLAIM-SELFTEST-CRC32'] },
    { args: ['claims'], ids: ['CLAIM-SELFTEST-CRC32', 'CLAIM-MILK-EXPR-OPERATORS'] },
    { args: ['requirements'], ids: ['REQ-SELFTEST-CRC32', 'REQ-MILK-EXPR-OPERATORS'] },
    { args: ['oracles'], ids: ['ORACLE-POLICY-SELFTEST', 'ORACLE-POLICY-MILK-EXPR'] },
    { args: ['inventory-coverage'], ids: ['INV-SELFTEST-CRC-OPERATIONS', 'INV-MILK-EXPR-STATEMENTS'] },
    { args: ['scope'], ids: ['scope.phosphene'] },
    { args: ['authorization'], ids: [] },
    { args: ['authorization-attestations'], ids: [] },
    { args: ['profiles'], ids: ['profile.phosphene-compatibility-port', 'profile.phosphene-graphics-runtime'] },
    { args: ['project-binding'], ids: ['project-binding.phosphene'] },
    { args: ['authorities'], ids: ['AUTH-RFC1952', 'AUTH-NSEEL2-CALTAB', 'AUTH-MILKDROP-EEL-PARSER'] },
    { args: ['conflicts'], ids: [] },
    { args: ['evidence'], ids: ['EV-SELFTEST-CRC32-EXPECTED', 'EV-MILK-EXPR-EXPECTED'] },
    { args: ['providers'], ids: ['PROVIDER-NODE-RUNTIME'] },
    { args: ['claim', 'CLAIM-MILK-EXPR-OPERATORS'], ids: ['CLAIM-MILK-EXPR-OPERATORS', 'FIX-MILK-EXPR-OPERATORS', 'CMP-EXACT-JSON'] },
    { args: ['requirement', 'REQ-MILK-EXPR-OPERATORS'], ids: ['REQ-MILK-EXPR-OPERATORS'] },
    { args: ['clean-claim', 'CLAIM-MILK-EXPR-OPERATORS'], ids: ['CLAIM-MILK-EXPR-OPERATORS'] },
    { args: ['clean-requirement', 'REQ-MILK-EXPR-OPERATORS'], ids: ['REQ-MILK-EXPR-OPERATORS'] },
    { args: ['clean-integrity'], ids: [] },
    { args: ['clean-completion'], ids: [] },
    { args: [], ids: [] }
  ];

  /** @type {any[]} */
  const entries = [];
  for (const m of material) {
    const name = (m.args.join('-') || 'verify-global').replace(/[^a-zA-Z0-9-]/g, '_');
    const started = new Date().toISOString();
    const run = spawnSync('node', [path.join(kitDir, 'bin', 'verify.mjs'), ...m.args], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ended = new Date().toISOString();
    const stdoutName = `${name}.stdout.txt`;
    const stderrName = `${name}.stderr.txt`;
    writeFileSync(path.join(bundleAbs, stdoutName), run.stdout ?? '');
    writeFileSync(path.join(bundleAbs, stderrName), run.stderr ?? '');
    const reportCmd = m.args.length === 0 ? 'verify' : m.args[0];
    const reportAbs = abs(repoRoot, `${hostTree(repoRoot).reportsDir}/latest-${reportCmd.replace(/[^a-z0-9-]/gi, '_')}.json`);
    let reportCopy = null;
    if (existsSync(reportAbs)) {
      const reportName = `${name}.report.json`;
      writeFileSync(path.join(bundleAbs, reportName), readFileSync(reportAbs, 'utf8'));
      reportCopy = { path: `${bundleRel}/${reportName}`, sha256: hashFile(path.join(bundleAbs, reportName)).sha256 };
    }
    entries.push({
      command: `verify ${m.args.join(' ')}`.trim(),
      arguments: m.args,
      workingDirectory: repoRoot,
      startedAt: started,
      endedAt: ended,
      exitCode: run.status,
      stdout: { path: `${bundleRel}/${stdoutName}`, sha256: hashFile(path.join(bundleAbs, stdoutName)).sha256 },
      stderr: { path: `${bundleRel}/${stderrName}`, sha256: hashFile(path.join(bundleAbs, stderrName)).sha256 },
      structuredReport: reportCopy,
      relatedIds: m.ids
    });
    process.stdout.write(`evidence-bundle: verify ${m.args.join(' ')} → exit ${run.status}\n`);
  }

  const parserVersion = JSON.parse(readFileSync(abs(repoRoot, 'tooling/reference-adapters/milkdrop-eel/package-lock.json'), 'utf8'))
    ?.packages?.['node_modules/milkdrop-eel-parser']?.version ?? 'unknown';
  const manifest = {
    bundleId: `${stamp}-${commit.slice(0, 8)}`,
    sourceCommit: commit,
    sourceTreeHash: treeHash,
    dirtyWorktreeAtGeneration: dirty,
    provenanceNote: 'Generated by "node tooling/verification-kit/bin/verify.mjs evidence-bundle". A bundle committed to the repository was necessarily generated at the recorded sourceCommit and lands in a later commit; the recorded commit and tree hash are the provenance anchor. Regenerate from a clean checkout with: git clone <repo> && npm ci in tooling/verification-kit and each tooling/reference-adapters/* && node tooling/verification-kit/bin/verify.mjs evidence-bundle.',
    runtime: {
      node: process.version,
      os: `${process.platform}`,
      kitPackageLockSha256: hashFile(abs(repoRoot, 'tooling/verification-kit/package-lock.json')).sha256,
      milkdropEelParserVersion: parserVersion
    },
    entries
  };
  const manifestPath = path.join(bundleAbs, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const manifestHash = hashFile(manifestPath).sha256;
  writeFileSync(path.join(bundleAbs, 'manifest.sha256'), `${manifestHash}  manifest.json\n`);
  process.stdout.write(`evidence-bundle: ${bundleRel} (manifest sha256 ${manifestHash.slice(0, 16)}…)\n`);
  return entries.every((e) => typeof e.exitCode === 'number') ? 0 : 1;
}

/** @param {string} repoRoot @returns {number} */
function cmdScope(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.filter((e) => e.includes('scope')).map((e) => ({ code: 'SCOPE_APPROVAL_MISSING', detail: e }));
  if (!store.scope) failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: 'verification/scope/scope.json is absent; author it from the user-authored scope text' });
  const lockCheck = verifyLock(repoRoot, lockSurfaces(store.tree).scope);
  for (const p of lockCheck.problems) failures.push({ code: 'EVIDENCE_STALE', detail: `[scope lock] ${p}` });
  if (store.scope) {
    const ws = witnessStatus(store, store.scope.authorizationWitnessId);
    if (ws.status !== 'verified-attested') {
      failures.push({
        code: ws.status === 'missing' ? 'SCOPE_APPROVAL_MISSING' : 'AUTHORIZATION_WITNESS_UNVERIFIED',
        detail: `scope approval witness ${ws.status}: ${ws.reasons.join('; ')}`
      });
    }
  }
  return finish(repoRoot, 'scope', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdAuthorization(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.filter((e) => e.includes('authorization')).map((e) => ({ code: 'AUTHORIZATION_WITNESS_UNVERIFIED', detail: e }));
  const lockCheck = verifyLock(repoRoot, lockSurfaces(store.tree).authorization);
  for (const p of lockCheck.problems) failures.push({ code: 'EVIDENCE_STALE', detail: `[authorization lock] ${p}` });
  if ((store.allowlist?.identities ?? []).length === 0) {
    failures.push({ code: 'AUTHORIZATION_WITNESS_MISSING', detail: 'identity allowlist is empty; authorization root of trust is not bootstrapped' });
  }
  if (store.bootstrap?.status !== 'established') {
    failures.push({
      code: 'AUTHORIZATION_WITNESS_MISSING',
      detail: `authorization bootstrap pending; required external actions: ${(store.bootstrap?.requiredExternalActions ?? []).join(' | ')}`
    });
  }
  return finish(repoRoot, 'authorization', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdAttestations(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const detail = [];
  for (const w of store.witnesses) {
    const ws = witnessStatus(store, w.witnessId);
    detail.push({ witnessId: w.witnessId, status: ws.status, reasons: ws.reasons });
    if (ws.status !== 'verified-attested') {
      failures.push({ code: 'AUTHORIZATION_ATTESTATION_INVALID', detail: `witness '${w.witnessId}': ${ws.status} (${ws.reasons.join('; ')})` });
    }
  }
  if (store.witnesses.length === 0) {
    failures.push({ code: 'AUTHORIZATION_WITNESS_MISSING', detail: 'no authorization witnesses retained' });
  }
  return finish(repoRoot, 'authorization-attestations', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { witnesses: detail });
}

/** @param {string} repoRoot @returns {number} */
function cmdProfiles(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.filter((e) => e.includes('profiles')).map((e) => ({ code: 'PROJECT_UNDERBOUND', detail: e }));
  const lockCheck = verifyLock(repoRoot, lockSurfaces(store.tree).profiles);
  for (const p of lockCheck.problems) failures.push({ code: 'EVIDENCE_STALE', detail: `[profiles lock] ${p}` });
  for (const sel of store.selectedProfiles?.selected ?? []) {
    const profile = store.profiles.find((pr) => pr.profileId === sel.profileId);
    if (!profile) {
      failures.push({ code: 'PROJECT_UNDERBOUND', detail: `selected profile '${sel.profileId}' has no record at ${sel.path}` });
      continue;
    }
    const selfHash = canonicalJsonHash({ ...profile, hash: 'sha256:SELF' });
    if (profile.hash !== selfHash) failures.push({ code: 'EVIDENCE_STALE', detail: `profile '${sel.profileId}' hash field does not match its content (expected ${selfHash})` });
    if (sel.hash !== profile.hash) failures.push({ code: 'EVIDENCE_STALE', detail: `selected.json pins '${sel.profileId}' at ${sel.hash} but the record carries ${profile.hash}` });
  }
  return finish(repoRoot, 'profiles', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdBinding(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.filter((e) => e.includes('binding')).map((e) => ({ code: 'PROJECT_BINDING_MISSING', detail: e }));
  if (!store.binding) {
    failures.push({ code: 'PROJECT_BINDING_MISSING', detail: 'verification/binding/project-verification-binding.json is absent' });
    return finish(repoRoot, 'project-binding', { result: 'FAIL', failures });
  }
  const lockCheck = verifyLock(repoRoot, lockSurfaces(store.tree).binding);
  for (const p of lockCheck.problems) failures.push({ code: 'EVIDENCE_STALE', detail: `[binding lock] ${p}` });
  if (store.scope) {
    const scopeHash = canonicalJsonHash(store.scope);
    if (store.binding.approvedScopeHash !== scopeHash) {
      failures.push({ code: 'EVIDENCE_STALE', detail: `binding approvedScopeHash ${store.binding.approvedScopeHash} does not match current scope ${scopeHash}` });
    }
  }
  for (const bp of store.binding.selectedProfiles ?? []) {
    const profile = store.profiles.find((pr) => pr.profileId === bp.profileId);
    if (!profile) failures.push({ code: 'PROJECT_UNDERBOUND', detail: `binding selects profile '${bp.profileId}' which has no record` });
    else if (profile.hash !== bp.hash) failures.push({ code: 'EVIDENCE_STALE', detail: `binding pins profile '${bp.profileId}' at ${bp.hash} but the record carries ${profile.hash}` });
  }
  const adoption = witnessStatus(store, store.binding.bindingAuthorization?.adoptionOrChangeWitnessId);
  if (adoption.status !== 'verified-attested') {
    failures.push({ code: adoption.status === 'missing' ? 'AUTHORIZATION_WITNESS_MISSING' : 'AUTHORIZATION_WITNESS_UNVERIFIED', detail: `binding adoption witness ${adoption.status}: ${adoption.reasons.join('; ')}` });
  }
  const adequacy = witnessStatus(store, store.binding.bindingAuthorization?.adequacyWitnessId);
  if (adequacy.status !== 'verified-attested') {
    failures.push({ code: 'BINDING_ADEQUACY_UNWITNESSED', detail: `binding adequacy witness ${adequacy.status}: ${adequacy.reasons.join('; ')}` });
  }
  return finish(repoRoot, 'project-binding', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdAuthorities(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.filter((e) => e.includes('authorities')).map((e) => ({ code: 'AUTHORITY_MISSING', detail: e }));
  const lockCheck = verifyLock(repoRoot, lockSurfaces(store.tree).authorities);
  for (const p of lockCheck.problems) failures.push({ code: 'EVIDENCE_STALE', detail: `[authorities lock] ${p}` });
  for (const a of store.authorities) {
    if (!a.rawArtifact) continue;
    const fileAbs = abs(repoRoot, a.rawArtifact.retainedPath);
    if (!existsSync(fileAbs)) {
      failures.push({ code: 'RAW_AUTHORITY_MUTATED', detail: `raw authority artifact missing: ${a.rawArtifact.retainedPath}` });
      continue;
    }
    const { sha256, bytes } = hashFile(fileAbs);
    if (sha256 !== a.rawArtifact.sha256 || bytes !== a.rawArtifact.byteLength) {
      failures.push({ code: 'RAW_AUTHORITY_MUTATED', detail: `raw authority '${a.authorityId}' does not match registered exact bytes at ${a.rawArtifact.retainedPath}` });
    }
  }
  return finish(repoRoot, 'authorities', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdConflicts(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  for (const c of store.conflicts) {
    if (c.status !== 'resolved') failures.push({ code: 'AUTHORITY_CONFLICT_UNRESOLVED', detail: `conflict '${c.conflictId}': ${c.unresolvedReason ?? 'unresolved'}` });
  }
  return finish(repoRoot, 'conflicts', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { count: store.conflicts.length });
}

/** @param {string} repoRoot @returns {number} */
function cmdEvidence(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  for (const surface of ['evidence', 'fixtures', 'comparators']) {
    const r = verifyLock(repoRoot, lockSurfaces(store.tree)[surface]);
    for (const p of r.problems) failures.push({ code: surface === 'fixtures' ? 'FIXTURE_STALE' : 'EVIDENCE_STALE', detail: `[${surface} lock] ${p}` });
  }
  for (const claim of store.claims) {
    failures.push(...evidenceCheck(store, claim));
    failures.push(...authoritiesCheck(store, claim));
  }
  return finish(repoRoot, 'evidence', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {number} */
function cmdOracles(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const traces = [];
  for (const claim of store.claims) {
    for (const reqId of claim.requirementIds ?? []) {
      const requirement = store.byId.get(reqId)?.record;
      if (!requirement) continue;
      const b = bindingFor(store, requirement);
      if (!b.bindingClass) continue;
      const r = oracleCheck(store, claim, b.bindingClass);
      failures.push(...r.failures);
      traces.push({ claimId: claim.claimId, ...r.trace });
    }
  }
  return finish(repoRoot, 'oracles', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { oracles: traces });
}

/** @param {string} repoRoot @returns {number} */
function cmdInventoryCoverage(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  for (const requirement of store.requirements) {
    const b = bindingFor(store, requirement);
    if (!b.bindingClass) continue;
    failures.push(...inventoryCheck(store, requirement, b.bindingClass));
  }
  return finish(repoRoot, 'inventory-coverage', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures });
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdRequirements(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const results = [];
  for (const requirement of store.requirements) {
    const r = await computeRequirementResult(store, requirement);
    results.push(r);
    if (r.result === 'FAIL') failures.push({ code: 'CHECK_FAILED', detail: `requirement '${r.requirementId}' fails (${r.failures[0]?.code ?? ''})` });
  }
  return finish(repoRoot, 'requirements', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { requirements: results });
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdClaims(repoRoot) {
  const store = load(repoRoot);
  const surfaceFailures = surfaceLockFailures(store);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const results = [];
  for (const claim of store.claims) {
    const r = await computeClaimResult(store, claim, surfaceFailures);
    results.push(r);
    if (r.result === 'FAIL') failures.push({ code: 'CHECK_FAILED', detail: `claim '${r.claimId}' fails (${r.failures[0]?.code ?? ''})` });
  }
  return finish(repoRoot, 'claims', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { claims: results });
}

/** @param {string} repoRoot @returns {number} */
function cmdProviders(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {any[]} */
  const detail = [];
  for (const p of store.providersConfig?.providers ?? []) {
    if (p.kind === 'node-module') {
      const ok = existsSync(abs(repoRoot, p.command));
      detail.push({ providerId: p.providerId, kind: p.kind, available: ok });
      if (!ok) failures.push({ code: 'PROVIDER_UNAVAILABLE', detail: `provider '${p.providerId}' module missing: ${p.command}` });
    } else {
      detail.push({ providerId: p.providerId, kind: p.kind, available: 'not-probed (command providers are probed by their checks)' });
    }
  }
  return finish(repoRoot, 'providers', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, { providers: detail });
}

/** @param {string} repoRoot @param {string | undefined} id @returns {Promise<number>} */
async function cmdOneRequirement(repoRoot, id) {
  if (!id) {
    process.stderr.write('usage: verify requirement <requirement-id>\n');
    return 2;
  }
  const store = load(repoRoot);
  const requirement = store.requirements.find((r) => r.requirementId === id);
  if (!requirement) {
    process.stderr.write(`requirement '${id}' not registered\n`);
    return 2;
  }
  const r = await computeRequirementResult(store, requirement);
  return finish(repoRoot, 'requirement', { result: r.result, failures: r.failures }, { requirementId: id, claims: r.claims });
}

/** @param {string} repoRoot @param {string | undefined} id @returns {Promise<number>} */
async function cmdOneClaim(repoRoot, id) {
  if (!id) {
    process.stderr.write('usage: verify claim <claim-id>\n');
    return 2;
  }
  const store = load(repoRoot);
  const claim = store.claims.find((c) => c.claimId === id);
  if (!claim) {
    process.stderr.write(`claim '${id}' not registered\n`);
    return 2;
  }
  const r = await computeClaimResult(store, claim, surfaceLockFailures(store));
  return finish(repoRoot, 'claim', { result: r.result, failures: r.failures }, { claimId: id, trace: r.trace });
}

/** @param {string} repoRoot @param {string[]} rest @returns {number} */
function cmdChangeIntegrity(repoRoot, rest) {
  const base = argValue(rest, '--base');
  const head = argValue(rest, '--head') ?? 'HEAD';
  if (!base) {
    process.stderr.write('usage: verify change-integrity --base <ref> [--head <ref>]\n');
    return 2;
  }
  const r = changeIntegrity(repoRoot, base, head);
  return finish(repoRoot, 'change-integrity', { result: r.failures.length === 0 ? 'PASS' : 'FAIL', failures: r.failures }, {
    base, head, notes: r.notes,
    disclaimer: 'merge-integrity comparison only; makes no claim that the project is complete or healthy'
  });
}

/** @param {string} repoRoot @param {string[]} rest @returns {Promise<number>} */
async function cmdCaptureOracle(repoRoot, rest) {
  const evidenceId = rest.find((a) => !a.startsWith('--'));
  const update = rest.includes('--update');
  if (!evidenceId) {
    process.stderr.write('usage: verify capture-oracle <evidence-id> [--update]\n');
    return 2;
  }
  const store = load(repoRoot);
  const evidence = store.evidence.find((e) => e.evidenceId === evidenceId);
  if (!evidence?.captureSpec) {
    process.stderr.write(`evidence '${evidenceId}' not found or has no captureSpec\n`);
    return 2;
  }
  const input = JSON.parse(readFileSync(abs(repoRoot, evidence.captureSpec.inputArtifact), 'utf8'));
  const run = await invokeCapability(store, evidence.captureSpec.adapterId, evidence.captureSpec.capabilityId, input);
  if (!run.ok) {
    return finish(repoRoot, 'capture-oracle', { result: 'FAIL', failures: [{ code: 'PROVIDER_UNAVAILABLE', detail: run.reason }] });
  }
  const serialized = JSON.stringify(run.result, null, 2) + '\n';
  const expectedAbs = abs(repoRoot, evidence.expectedResultArtifact);
  const exists = existsSync(expectedAbs);
  const current = exists ? readFileSync(expectedAbs, 'utf8') : undefined;
  if (exists && current === serialized && !update) {
    return finish(repoRoot, 'capture-oracle', { result: 'PASS', failures: [] }, { evidenceId, drift: false, note: 'oracle output matches the retained expected artifact byte-for-byte' });
  }
  if (!update) {
    return finish(repoRoot, 'capture-oracle', {
      result: 'FAIL',
      failures: [{ code: 'EVIDENCE_STALE', detail: exists ? 'oracle output differs from retained expected artifact; rerun with --update and re-lock with a reason' : 'expected artifact absent; run with --update to capture it' }]
    }, { evidenceId, drift: true });
  }
  writeFileSync(expectedAbs, serialized);
  const newHash = `sha256:${hashFile(expectedAbs).sha256}`;
  rewriteRecordField(repoRoot, store.tree.evidenceDir, evidenceId, 'evidenceId', (rec) => ({ ...rec, contentHash: newHash }));
  for (const fixture of store.fixtures.filter((f) => f.expectedArtifact === evidence.expectedResultArtifact)) {
    const inputBytes = readFileSync(abs(repoRoot, fixture.inputArtifact));
    const expectedBytes = readFileSync(expectedAbs);
    const fixtureHash = `sha256:${sha256Hex(Buffer.concat([inputBytes, expectedBytes]))}`;
    rewriteRecordField(repoRoot, store.tree.fixtureRecordsDir, fixture.fixtureId, 'fixtureId', (rec) => ({ ...rec, fixtureHash }));
  }
  return finish(repoRoot, 'capture-oracle', { result: 'PASS', failures: [] }, {
    evidenceId, updated: true, contentHash: newHash,
    note: 'expected artifact captured from the oracle; evidence and fixture hashes updated; run evidence-lock and fixtures-lock with a reason'
  });
}

/**
 * Rewrite one record file (named <id>.json by convention) with an updated field.
 * @param {string} repoRoot @param {string} dirRel @param {string} id @param {string} idField @param {(rec: any) => any} transform
 */
function rewriteRecordField(repoRoot, dirRel, id, idField, transform) {
  const fileAbs = abs(repoRoot, `${dirRel}/${id}.json`);
  if (!existsSync(fileAbs)) throw new Error(`record file not found (convention <id>.json): ${dirRel}/${id}.json`);
  const rec = JSON.parse(readFileSync(fileAbs, 'utf8'));
  if (rec[idField] !== id) throw new Error(`record file ${dirRel}/${id}.json carries ${idField}='${rec[idField]}'`);
  writeFileSync(fileAbs, JSON.stringify(transform(rec), null, 2) + '\n');
}

/** @param {string} repoRoot @param {string} surfaceName @param {string[]} rest @returns {number} */
function cmdLock(repoRoot, surfaceName, rest) {
  const reason = argValue(rest, '--reason');
  const witness = argValue(rest, '--authorization-witness') ?? null;
  if (!reason) {
    process.stderr.write(`usage: verify ${surfaceName}-lock --reason "..." [--authorization-witness <witness-id>]\n`);
    return 2;
  }
  const tree = hostTree(repoRoot);
  const surface = lockSurfaces(tree)[surfaceName === 'binding' ? 'binding' : surfaceName];
  const r = updateLock(repoRoot, `lock.${surfaceName}`, surface, reason, `verify ${surfaceName}-lock`, witness);
  const reportPath = writeReport({ repoRoot, tree }, `${surfaceName}-lock`, {
    result: 'PASS', reason, authorizationWitnessId: witness, changes: r.changes,
    note: 'a lock update makes a change visible; it does not establish that the changed content is correct'
  });
  process.stdout.write(`${surfaceName}-lock: updated (${r.changes.length} change${r.changes.length === 1 ? '' : 's'})\n`);
  for (const c of r.changes.slice(0, 20)) process.stdout.write(`  ${c.kind}: ${c.path}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  return 0;
}

/** @param {string} repoRoot @returns {Promise<number>} */
async function cmdFramework(repoRoot) {
  const store = load(repoRoot);
  const r = await computeFrameworkResult(store, kitDir);
  return finish(repoRoot, 'framework', { result: r.result, failures: r.failures }, {
    coverageMatrix: r.matrix,
    selfTest: r.selfTest,
    negativeControls: r.negativeControls,
    fixtureRepoScenarios: r.fixtureRepoScenarios,
    auditControls: r.auditControls,
    bindingFieldAudit: r.bindingFieldAudit,
    bootstrapConformance: r.bootstrapConformance,
    conformanceSuite: r.conformanceSuite,
    attestationLineage: r.attestationLineage,
    note: 'partial framework construction appears as a failed matrix, not a progress narrative (framework spec §15)'
  });
}

/** @param {string[]} args @param {string} name @returns {string | undefined} */
function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
