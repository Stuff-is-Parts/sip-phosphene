import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, hostTree, abs } from '../core/paths.mjs';
import { loadStore } from '../core/store.mjs';
import { hashFile, canonicalJsonHash, sha256Hex } from '../core/hash.mjs';
import { writeReport } from '../core/report.mjs';
import { initialize } from '../core/init.mjs';
import { lockSurfaces, verifyLock, updateLock } from '../core/locks.mjs';
import { findOrphans } from '../core/orphans.mjs';
import {
  computeClaimResult, computeRequirementResult, computeGlobalResult,
  surfaceLockFailures, oracleCheck, bindingFor, inventoryCheck, authoritiesCheck, evidenceCheck
} from '../core/engine.mjs';
import { runNegativeControls } from '../core/negcontrols.mjs';
import { runFixtureRepoScenarios } from '../core/selftest.mjs';
import { changeIntegrity } from '../core/integrity.mjs';
import { runClean } from '../core/clean.mjs';
import { witnessStatus } from '../core/authorization.mjs';
import { invokeCapability } from '../core/adapters.mjs';

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
    case 'clean': return cmdClean(repoRoot);
    case 'capture-oracle': return cmdCaptureOracle(repoRoot, rest);
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

/** @param {string} repoRoot @returns {Promise<number>} */
async function globalVerify(repoRoot) {
  const store = load(repoRoot);
  /** @type {Array<{code: string, detail: string}>} */
  const failures = store.structuralErrors.map((e) => ({ code: 'EVIDENCE_MISSING', detail: `[structural] ${e}` }));
  const g = await computeGlobalResult(store);
  failures.push(...g.failures);
  const result = failures.length === 0 ? 'PASS' : 'FAIL';
  return finish(repoRoot, 'verify', { result: /** @type {'PASS' | 'FAIL'} */ (result), failures }, {
    note: 'sole global completion gate: the project passes only when every user-scoped requirement currently passes',
    requirements: g.requirements
  });
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

/** @param {string} repoRoot @returns {number} */
function cmdClean(repoRoot) {
  const r = runClean(repoRoot);
  const failed = r.steps.filter((s) => s.exitCode !== 0 && s.step !== 'global-verify');
  const globalStep = r.steps.find((s) => s.step === 'global-verify');
  /** @type {Array<{code: string, detail: string}>} */
  const failures = failed.map((s) => ({ code: 'CHECK_FAILED', detail: `clean step '${s.step}' exited ${s.exitCode}` }));
  return finish(repoRoot, 'clean', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    steps: r.steps.map((s) => ({ step: s.step, exitCode: s.exitCode })),
    globalVerifyInClean: globalStep ? (globalStep.exitCode === 0 ? 'PASS' : 'FAIL (expected while the project is incomplete; see completion report)') : 'not-run',
    note: 'clean gate covers framework integrity; the global verify result inside the clean run is reported, not gated here'
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
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];

  for (const e of store.structuralErrors) failures.push({ code: 'EVIDENCE_MISSING', detail: `[schema/structure] ${e}` });

  /** @type {Record<string, {ok: boolean, detail: string}>} */
  const positives = {};

  const surfaces = lockSurfaces(store.tree);
  /** @type {string[]} */
  const lockProblems = [];
  for (const [name, surface] of Object.entries(surfaces)) {
    const r = verifyLock(repoRoot, surface);
    if (!r.ok) lockProblems.push(...r.problems.map((p) => `[${name}] ${p}`));
  }
  positives['lock-system'] = { ok: lockProblems.length === 0, detail: lockProblems.length === 0 ? 'all 8 lock surfaces current' : lockProblems.join('; ') };
  for (const p of lockProblems) failures.push({ code: 'EVIDENCE_STALE', detail: `[lock] ${p}` });

  const orphans = findOrphans(store);
  positives['orphan-detection'] = { ok: orphans.length === 0, detail: orphans.length === 0 ? 'no orphan writes or reads' : orphans.join('; ') };
  for (const o of orphans) failures.push({ code: 'CHECK_MISSING', detail: `[orphan] ${o}` });

  const selfTestReqs = store.requirements.filter((r) => r.frameworkOnly);
  if (selfTestReqs.length === 0) {
    failures.push({ code: 'CHECK_MISSING', detail: 'no framework self-test requirements registered (framework spec §24)' });
    positives['self-test-vertical-path'] = { ok: false, detail: 'no self-test requirements' };
  }
  /** @type {any[]} */
  const selfTestResults = [];
  for (const requirement of selfTestReqs) {
    const r = await computeRequirementResult(store, requirement);
    selfTestResults.push(r);
    if (r.result === 'FAIL') {
      for (const f of r.failures) failures.push({ code: f.code, detail: `[self-test ${r.requirementId}] ${f.detail}` });
    }
  }
  if (selfTestReqs.length > 0) {
    const allPass = selfTestResults.every((r) => r.result === 'PASS');
    positives['self-test-vertical-path'] = { ok: allPass, detail: allPass ? `${selfTestResults.length} framework-only requirement(s) PASS through oracle→fixture→subject→comparator` : 'self-test requirement failing (see failures)' };
  }

  const negatives = await runNegativeControls(store);
  const negativesOk = negatives.length > 0 && negatives.every((n) => n.ok);
  positives['negative-controls'] = {
    ok: negativesOk,
    detail: negatives.length === 0 ? 'no negative controls registered' : negatives.map((n) => `${n.evaluatorId}: ${n.ok ? 'rejected for intended reason' : n.detail}`).join(' | ')
  };
  for (const n of negatives.filter((x) => !x.ok)) failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: `${n.evaluatorId}: ${n.detail}` });
  if (negatives.length === 0) failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: 'no negative controls registered' });

  const fixtureScenarios = runFixtureRepoScenarios(path.join(kitDir));
  for (const s of fixtureScenarios) {
    positives[`initializer:${s.scenario}`] = { ok: s.ok, detail: s.detail };
    if (!s.ok) failures.push({ code: 'CHECK_FAILED', detail: `[initializer] ${s.scenario}: ${s.detail}` });
  }

  const matrix = buildMatrix(store, positives);
  for (const row of matrix) {
    if (!row.implementationPresent) failures.push({ code: 'CHECK_MISSING', detail: `[matrix] mechanism '${row.mechanism}' implementation absent` });
    if (row.positiveControl === 'ABSENT') failures.push({ code: 'CHECK_MISSING', detail: `[matrix] mechanism '${row.mechanism}' has no executed positive control` });
    if (row.negativeControl === 'ABSENT') failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: `[matrix] mechanism '${row.mechanism}' has no executed negative control` });
    if (row.positiveControl === 'FAIL' || row.negativeControl === 'FAIL') failures.push({ code: 'CHECK_FAILED', detail: `[matrix] mechanism '${row.mechanism}' control failing` });
  }

  return finish(repoRoot, 'framework', { result: failures.length === 0 ? 'PASS' : 'FAIL', failures }, {
    coverageMatrix: matrix,
    selfTest: selfTestResults,
    negativeControls: negatives,
    fixtureRepoScenarios: fixtureScenarios,
    note: 'partial framework construction appears as a failed matrix, not a progress narrative (framework spec §15)'
  });
}

/**
 * Derive the §15 coverage matrix from this run's executed controls.
 * @param {import('../core/store.mjs').Store} store
 * @param {Record<string, {ok: boolean, detail: string}>} positives
 * @returns {Array<{mechanism: string, implementationPresent: boolean, positiveControl: string, negativeControl: string, detail: string}>}
 */
function buildMatrix(store, positives) {
  const src = path.join(kitDir, 'src');
  /** @param {string} p @returns {boolean} */
  const present = (p) => existsSync(path.join(src, ...p.split('/')));
  /** @param {string} key @returns {string} */
  const pos = (key) => positives[key] ? (positives[key].ok ? 'PASS' : 'FAIL') : 'ABSENT';

  const negControlsExecuted = positives['negative-controls']?.ok === true;
  /** @type {Array<{mechanism: string, implementationPresent: boolean, positiveControl: string, negativeControl: string, detail: string}>} */
  const rows = [
    { mechanism: 'schema-validation', implementationPresent: present('core/schemas.mjs'), positiveControl: store.structuralErrors.length === 0 ? 'PASS' : 'FAIL', negativeControl: 'ABSENT', detail: 'negative control (invalid record rejected with precise error) not yet registered as a fixture scenario' },
    { mechanism: 'lock-system', implementationPresent: present('core/locks.mjs'), positiveControl: pos('lock-system'), negativeControl: 'ABSENT', detail: 'stale-hash rejection scenario not yet registered' },
    { mechanism: 'orphan-detection', implementationPresent: present('core/orphans.mjs'), positiveControl: pos('orphan-detection'), negativeControl: 'ABSENT', detail: 'seeded-orphan rejection scenario not yet registered' },
    { mechanism: 'oracle-precedence', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'stronger-oracle-bypass rejection scenario not yet registered' },
    { mechanism: 'alternative-union', implementationPresent: present('core/union.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'claim-level trimming rejection scenario not yet registered' },
    { mechanism: 'fixture-discrimination', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : (positives['negative-controls'] ? 'FAIL' : 'ABSENT'), detail: 'evaluator mutants rejected through the subject-execution check' },
    { mechanism: 'comparator-exactness', implementationPresent: present('core/compare.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : 'ABSENT', detail: 'mutant divergences detected by exact comparison' },
    { mechanism: 'subject-execution', implementationPresent: present('core/adapters.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : 'ABSENT', detail: 'actual subject executed through registered adapter capability' },
    { mechanism: 'negative-control-machinery', implementationPresent: present('core/negcontrols.mjs'), positiveControl: pos('negative-controls'), negativeControl: 'ABSENT', detail: 'wrong-reason-failure rejection scenario not yet registered' },
    { mechanism: 'authorization-witness-verification', implementationPresent: present('core/authorization.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'requires bootstrapped allowlist (pending user repository-administration action) plus forged-witness rejection scenario' },
    { mechanism: 'attestation-integrity', implementationPresent: present('core/authorization.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'requires a live authenticated verification job to produce the first attestation' },
    { mechanism: 'inventory-coverage', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'unclaimed-item rejection scenario not yet registered' },
    { mechanism: 'change-integrity', implementationPresent: present('core/integrity.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'positive and regression scenarios not yet registered; command is executable via verify change-integrity' },
    { mechanism: 'clean-environment', implementationPresent: present('core/clean.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'run via verify clean and the CI clean-environment job' },
    { mechanism: 'structured-reports', implementationPresent: present('core/report.mjs'), positiveControl: 'PASS', negativeControl: 'ABSENT', detail: 'this run writes structured reports; malformed-report rejection not applicable as negative control shape yet' },
    { mechanism: 'initializer', implementationPresent: present('core/init.mjs'), positiveControl: pos('initializer:init-empty-git-repo'), negativeControl: pos('initializer:missing-scope-fails-loudly'), detail: 'idempotence and non-Node host proven black-box; missing-scope loud failure is the negative control' },
    { mechanism: 'equivalence-claims', implementationPresent: present('core/engine.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'no equivalence claim registered yet; circular-equivalence rejection scenario pending' },
    { mechanism: 'runtime-effect-witnessing', implementationPresent: present('core/engine.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'no runtime-effect claim registered yet; scaffolding-only rejection scenario pending' },
    { mechanism: 'capture-oracle', implementationPresent: present('cli/main.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'drift-rejection scenario not yet registered' }
  ];
  return rows;
}

/** @param {string[]} args @param {string} name @returns {string | undefined} */
function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
